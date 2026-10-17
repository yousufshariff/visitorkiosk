import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../server/db/schema';
import { freshDb, type TestDb } from '../server/testing/pg';
import { importHosts } from './import-hosts';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.pool.query('TRUNCATE users CASCADE');
});

const H = 'name,email,department,slack_user_id,slack_webhook_url,teams_webhook_url';

describe('importHosts', () => {
  it('upserts valid rows', async () => {
    const r = await importHosts(t.db, `${H}\nHana Host,hana@example.test,Sales,U123ABC,https://hooks.slack.test/a,https://teams.test/b\nHank Hill,hank@example.test,,,,\n`);
    expect(r).toEqual({ upserted: 2, errors: [] });
    const [h] = await t.db.select().from(users).where(eq(users.email, 'hana@example.test'));
    expect(h).toMatchObject({ fullName: 'Hana Host', department: 'Sales', slackUserId: 'U123ABC', slackWebhookUrl: 'https://hooks.slack.test/a', teamsWebhookUrl: 'https://teams.test/b', isActive: true });
    const [k] = await t.db.select().from(users).where(eq(users.email, 'hank@example.test'));
    expect(k).toMatchObject({ department: null, slackUserId: null, slackWebhookUrl: null, teamsWebhookUrl: null });
  });
  it('a second run updates by case-insensitive email instead of duplicating', async () => {
    await importHosts(t.db, `${H}\nHana Host,hana@example.test,Sales,,,\n`);
    await importHosts(t.db, `${H}\nHana H.,HANA@example.test,Marketing,,,\n`);
    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fullName: 'Hana H.', department: 'Marketing' });
  });
  it('reports bad rows with their CSV line number and still imports the good ones', async () => {
    const csv = [H, 'Good One,good@example.test,,,,', ',noname@example.test,,,,', 'Bad Email,not-an-email,,,,', 'Http Hook,http@example.test,,,http://insecure.test/x,', 'Also Good,also@example.test,,,,'].join('\n');
    const r = await importHosts(t.db, csv);
    expect(r.upserted).toBe(2);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(r.errors.every((e) => e.message.length > 0)).toBe(true);
    expect((await t.db.select().from(users)).map((u) => u.email).sort()).toEqual(['also@example.test', 'good@example.test']);
  });
  it('ignores unknown extra columns', async () => {
    const r = await importHosts(t.db, 'name,email,cost_centre\nHana,hana@example.test,42\n');
    expect(r).toEqual({ upserted: 1, errors: [] });
  });
  it('a header-only file imports nothing', async () => {
    expect(await importHosts(t.db, `${H}\n`)).toEqual({ upserted: 0, errors: [] });
  });
  it('does not reactivate or deactivate existing users', async () => {
    await t.db.insert(users).values({ fullName: 'Gone', email: 'gone@example.test', isActive: false });
    await importHosts(t.db, `${H}\nGone Renamed,gone@example.test,,,,\n`);
    const [u] = await t.db.select().from(users);
    expect(u).toMatchObject({ fullName: 'Gone Renamed', isActive: false });
  });
  it('skips blank lines but keeps line numbers accurate', async () => {
    const r = await importHosts(t.db, `${H}\n\nBad,nope,,,,\n`);
    expect(r.errors.map((e) => e.line)).toEqual([3]);
  });
});
