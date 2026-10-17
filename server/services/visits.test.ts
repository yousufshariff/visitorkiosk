import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationTarget, VisitorArrival } from '../../shared/types';
import type { Deps } from '../deps';
import { visitors, visits } from '../db/schema';
import { AppError } from '../errors';
import { MemoryPhotoStore, PhotoError, type PhotoStore } from '../photos';
import { freshDb, type TestDb } from '../testing/pg';
import { seedHost } from '../testing/seed';
import { checkIn, checkOut, scanCheckIn, searchOnSite } from './visits';

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;

let t: TestDb;
let photos: MemoryPhotoStore;
let sent: { a: VisitorArrival; t: NotificationTarget }[];
let deps: Deps;
let host: Awaited<ReturnType<typeof seedHost>>;

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.pool.query('TRUNCATE visits, visitors, users CASCADE');
  photos = new MemoryPhotoStore();
  sent = [];
  deps = { db: t.db, photos, notify: { visitor: (a, tg) => void sent.push({ a, t: tg }), delivery() {} } };
  host = await seedHost(t.db, { fullName: 'Hana Host', slackWebhookUrl: 'https://hooks.test/h', slackUserId: 'U123ABC' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const base = () => ({ fullName: 'Vic Visitor', company: 'Acme', email: 'vic@example.test', hostId: host.id });
const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof AppError || e instanceof PhotoError ? e.status : `other:${String(e)}`;
  }
  return 'ok';
};

describe('checkIn', () => {
  it('creates a checked-in visit, stores the photo key, and notifies the host once', async () => {
    const { visitId } = await checkIn(deps, { ...base(), photoBase64: jpeg });
    const [v] = await t.db.select().from(visits).where(eq(visits.id, visitId));
    expect(v).toMatchObject({ status: 'checked_in', hostId: host.id });
    expect(v!.checkedInAt).toBeInstanceOf(Date);
    expect(v!.qrToken.length).toBeGreaterThanOrEqual(24);
    expect(v!.photoUrl).toMatch(/^visits\/[0-9a-f-]{36}\.jpg$/);
    expect(photos.objects.size).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.a).toMatchObject({ visitorName: 'Vic Visitor', company: 'Acme', hostName: 'Hana Host', photoUrl: `memory://${v!.photoUrl}` });
    expect(sent[0]!.t).toEqual({ slackWebhookUrl: 'https://hooks.test/h', teamsWebhookUrl: undefined, slackUserId: 'U123ABC' });
  });
  it('accepts phone-only visitors', async () => {
    await expect(checkIn(deps, { fullName: 'Pat', phone: '555-0101', hostId: host.id })).resolves.toHaveProperty('visitId');
  });
  it('rejects a visitor with neither email nor phone (400)', async () => {
    expect(await status(() => checkIn(deps, { fullName: 'Nobody', email: '  ', hostId: host.id }))).toBe(400);
  });
  it('rejects a blank name (400)', async () => {
    expect(await status(() => checkIn(deps, { ...base(), fullName: '   ' }))).toBe(400);
  });
  it('unknown, inactive or malformed host id → 404 and nothing written', async () => {
    const inactive = await seedHost(t.db, { isActive: false });
    for (const hostId of ['00000000-0000-4000-8000-000000000000', inactive.id, 'not-a-uuid']) {
      expect(await status(() => checkIn(deps, { ...base(), hostId, photoBase64: jpeg }))).toBe(404);
    }
    expect((await t.db.select().from(visitors)).length).toBe(0);
    expect(photos.objects.size).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('the same email checked in twice, even concurrently, yields one visitor and two visits', async () => {
    const results = await Promise.allSettled([
      checkIn(deps, base()),
      checkIn(deps, { ...base(), company: 'Acme 2' }),
      checkIn(deps, { ...base(), fullName: 'Vic V.', email: 'VIC@example.test' }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect((await t.db.select().from(visitors)).length).toBe(1);
    expect((await t.db.select().from(visits)).length).toBe(3);
  });
  it('a later check-in updates the stored name and company', async () => {
    await checkIn(deps, base());
    await checkIn(deps, { ...base(), fullName: 'Victoria Visitor', company: 'NewCo' });
    const [v] = await t.db.select().from(visitors);
    expect(v).toMatchObject({ fullName: 'Victoria Visitor', company: 'NewCo' });
  });
  it('an S3 failure still checks the visitor in, without a photo', async () => {
    const broken: PhotoStore = { put: async () => Promise.reject(new Error('s3 down')) };
    const { visitId } = await checkIn({ ...deps, photos: broken }, { ...base(), photoBase64: jpeg });
    const [v] = await t.db.select().from(visits).where(eq(visits.id, visitId));
    expect(v!.photoUrl).toBeNull();
    expect(sent[0]!.a.photoUrl).toBeUndefined();
  });
  it('an invalid photo is rejected with its status and writes nothing', async () => {
    expect(await status(() => checkIn(deps, { ...base(), photoBase64: 'data:image/png;base64,AAAA' }))).toBe(400);
    expect((await t.db.select().from(visitors)).length).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('a throwing notifier does not fail the check-in', async () => {
    const bad: Deps = { ...deps, notify: { visitor: () => { throw new Error('boom'); }, delivery() {} } };
    await expect(checkIn(bad, base())).resolves.toHaveProperty('visitId');
  });
});

describe('scanCheckIn', () => {
  const prebook = async (over: Partial<typeof visits.$inferInsert> = {}) => {
    const [vis] = await t.db.insert(visitors).values({ fullName: 'Pre Booked', email: 'pre@example.test' }).returning();
    await t.db.insert(visits).values({ visitorId: vis!.id, hostId: host.id, qrToken: `tok-${Math.random()}`, ...over });
    const [v] = await t.db.select().from(visits).where(eq(visits.visitorId, vis!.id));
    return v!;
  };
  it('checks in a pre-booked visit, returns names and notifies once', async () => {
    const v = await prebook();
    await expect(scanCheckIn(deps, v.qrToken)).resolves.toEqual({ visitorName: 'Pre Booked', hostName: 'Hana Host' });
    const [after] = await t.db.select().from(visits).where(eq(visits.id, v.id));
    expect(after).toMatchObject({ status: 'checked_in' });
    expect(after!.checkedInAt).toBeInstanceOf(Date);
    expect(sent).toHaveLength(1);
  });
  it('unknown token → 404', async () => {
    expect(await status(() => scanCheckIn(deps, 'nope'))).toBe(404);
  });
  it.each(['checked_in', 'checked_out', 'cancelled', 'no_show'] as const)('a %s visit → 409 and no notification', async (s) => {
    const v = await prebook({ status: s, ...(s === 'checked_out' ? { checkedInAt: new Date(Date.now() - 1000), checkedOutAt: new Date() } : {}) });
    expect(await status(() => scanCheckIn(deps, v.qrToken))).toBe(409);
    expect(sent).toHaveLength(0);
  });
  it('two simultaneous scans: one succeeds, one is 409, one notification', async () => {
    const v = await prebook();
    const r = await Promise.all([status(() => scanCheckIn(deps, v.qrToken)), status(() => scanCheckIn(deps, v.qrToken))]);
    expect(r.sort()).toEqual([409, 'ok']);
    expect(sent).toHaveLength(1);
  });
});

describe('checkOut', () => {
  it('checks out by visitId and by qrToken', async () => {
    const a = await checkIn(deps, base());
    await checkOut(deps, { visitId: a.visitId });
    const [va] = await t.db.select().from(visits).where(eq(visits.id, a.visitId));
    expect(va).toMatchObject({ status: 'checked_out' });
    expect(va!.checkedOutAt).toBeInstanceOf(Date);

    const b = await checkIn(deps, { ...base(), email: 'b@example.test' });
    const [vb] = await t.db.select().from(visits).where(eq(visits.id, b.visitId));
    await checkOut(deps, { qrToken: vb!.qrToken });
    const [vb2] = await t.db.select().from(visits).where(eq(visits.id, b.visitId));
    expect(vb2!.status).toBe('checked_out');
  });
  it('is idempotent and keeps the first checkout time', async () => {
    const a = await checkIn(deps, base());
    await checkOut(deps, { visitId: a.visitId });
    const [first] = await t.db.select().from(visits).where(eq(visits.id, a.visitId));
    await expect(checkOut(deps, { visitId: a.visitId })).resolves.toBeUndefined();
    const [second] = await t.db.select().from(visits).where(eq(visits.id, a.visitId));
    expect(second!.checkedOutAt).toEqual(first!.checkedOutAt);
  });
  it('unknown id, malformed id or token → 404', async () => {
    expect(await status(() => checkOut(deps, { visitId: '00000000-0000-4000-8000-000000000000' }))).toBe(404);
    expect(await status(() => checkOut(deps, { visitId: 'junk' }))).toBe(404);
    expect(await status(() => checkOut(deps, { qrToken: 'junk' }))).toBe(404);
  });
  it('neither field → 400', async () => {
    expect(await status(() => checkOut(deps, {}))).toBe(400);
  });
  it('a visit that is not checked in → 409', async () => {
    const [vis] = await t.db.insert(visitors).values({ fullName: 'P', email: 'p@example.test' }).returning();
    const [v] = await t.db.insert(visits).values({ visitorId: vis!.id, hostId: host.id, qrToken: 'pb' }).returning();
    expect(await status(() => checkOut(deps, { visitId: v!.id }))).toBe(409);
  });
});

describe('searchOnSite', () => {
  it('lists only checked-in visitors matching the text, names only', async () => {
    const a = await checkIn(deps, { ...base(), fullName: 'Alice Anders', email: 'alice@example.test' });
    const b = await checkIn(deps, { ...base(), fullName: 'Alicia Out', email: 'alicia@example.test' });
    await checkOut(deps, { visitId: b.visitId });
    await checkIn(deps, { ...base(), fullName: 'Bob', email: 'bob@example.test' });
    const r = await searchOnSite(deps, 'ALI');
    expect(r).toEqual([{ visitId: a.visitId, visitorName: 'Alice Anders' }]);
  });
  it('treats % literally, caps results at 10 and tolerates a huge query', async () => {
    for (let i = 0; i < 12; i++) await checkIn(deps, { ...base(), fullName: `Many ${i}`, email: `m${i}@example.test` });
    expect(await searchOnSite(deps, '%')).toEqual([]);
    expect(await searchOnSite(deps, 'Many')).toHaveLength(10);
    expect(await searchOnSite(deps, 'x'.repeat(5000))).toEqual([]);
  });
});
