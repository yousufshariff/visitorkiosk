import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryPhotoStore } from '../photos';
import { freshDb, type TestDb } from '../testing/pg';
import { seedHost } from '../testing/seed';
import type { Deps } from '../deps';
import { searchHosts } from './hosts';

let t: TestDb;
let deps: Deps;
beforeAll(async () => {
  t = await freshDb();
  deps = { db: t.db, photos: new MemoryPhotoStore(), notify: { visitor() {}, delivery() {} } };
  await seedHost(t.db, { fullName: 'Hana Host', department: 'Sales', phone: '555-0100', slackWebhookUrl: 'https://hooks.slack.test/secret' });
  await seedHost(t.db, { fullName: 'Hank Hill' });
  await seedHost(t.db, { fullName: 'Inactive Ian', isActive: false });
  await seedHost(t.db, { fullName: '100% Percy' });
  await seedHost(t.db, { fullName: 'Under_score Una' });
  for (let i = 0; i < 12; i++) await seedHost(t.db, { fullName: `Zed Number${String(i).padStart(2, '0')}` });
});
afterAll(async () => {
  await t.close();
});

describe('searchHosts', () => {
  it('matches a case-insensitive substring of the name', async () => {
    const r = await searchHosts(deps, 'AN');
    expect(r.map((h) => h.fullName)).toEqual(['Hana Host', 'Hank Hill']);
  });
  it('excludes inactive hosts', async () => {
    expect(await searchHosts(deps, 'Inactive')).toEqual([]);
  });
  it('returns at most 10 results ordered by name', async () => {
    const r = await searchHosts(deps, 'Zed');
    expect(r).toHaveLength(10);
    expect(r.map((h) => h.fullName)).toEqual([...r.map((h) => h.fullName)].sort());
  });
  it('treats % and _ literally', async () => {
    expect((await searchHosts(deps, '%')).map((h) => h.fullName)).toEqual(['100% Percy']);
    expect((await searchHosts(deps, '_')).map((h) => h.fullName)).toEqual(['Under_score Una']);
  });
  it('truncates a very long query instead of failing', async () => {
    expect(await searchHosts(deps, 'a'.repeat(5000))).toEqual([]);
  });
  it('returns only id, fullName and department', async () => {
    const [h] = await searchHosts(deps, 'Hana');
    expect(Object.keys(h!).sort()).toEqual(['department', 'fullName', 'id']);
    expect(JSON.stringify(h)).not.toMatch(/example\.test|slack|555/);
  });
  it('omits department when the host has none', async () => {
    const [h] = await searchHosts(deps, 'Hank');
    expect(h).not.toHaveProperty('department');
  });
});
