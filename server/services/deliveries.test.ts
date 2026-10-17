import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryArrival, DeliveryInput, NotificationTarget } from '../../shared/types';
import type { Deps } from '../deps';
import { deliveries } from '../db/schema';
import { AppError } from '../errors';
import { MemoryPhotoStore, type PhotoStore } from '../photos';
import { freshDb, type TestDb } from '../testing/pg';
import { seedHost } from '../testing/seed';
import { dropOff } from './deliveries';

const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;

let t: TestDb;
let photos: MemoryPhotoStore;
let sent: { d: DeliveryArrival; t: NotificationTarget }[];
let deps: Deps;
let host: Awaited<ReturnType<typeof seedHost>>;

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.pool.query('TRUNCATE deliveries, users CASCADE');
  photos = new MemoryPhotoStore();
  sent = [];
  deps = { db: t.db, photos, notify: { visitor() {}, delivery: (d, tg) => void sent.push({ d, t: tg }) } };
  host = await seedHost(t.db, { fullName: 'Hana Host', teamsWebhookUrl: 'https://teams.test/h' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const base = (): DeliveryInput => ({ carrier: 'UPS', type: 'package', recipientId: host.id });
const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof AppError ? e.status : `other:${String(e)}`;
  }
  return 'ok';
};

describe('dropOff', () => {
  it('records a received delivery with its photo key and notifies the recipient once', async () => {
    const { deliveryId } = await dropOff(deps, { ...base(), photoBase64: jpeg });
    const [d] = await t.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(d).toMatchObject({ carrier: 'UPS', type: 'package', status: 'received', recipientId: host.id });
    expect(d!.photoUrl).toMatch(/^deliveries\/[0-9a-f-]{36}\.jpg$/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.d).toMatchObject({ carrier: 'UPS', type: 'package', recipientName: 'Hana Host', photoUrl: `memory://${d!.photoUrl}` });
    expect(sent[0]!.t.teamsWebhookUrl).toBe('https://teams.test/h');
  });
  it('works without a photo', async () => {
    const { deliveryId } = await dropOff(deps, base());
    const [d] = await t.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(d!.photoUrl).toBeNull();
  });
  it('unknown, inactive or malformed recipient → 404 and no row', async () => {
    const inactive = await seedHost(t.db, { isActive: false });
    for (const recipientId of ['00000000-0000-4000-8000-000000000000', inactive.id, 'junk']) {
      expect(await status(() => dropOff(deps, { ...base(), recipientId, photoBase64: jpeg }))).toBe(404);
    }
    expect((await t.db.select().from(deliveries)).length).toBe(0);
    expect(photos.objects.size).toBe(0);
    expect(sent).toHaveLength(0);
  });
  it('rejects a blank or over-long carrier (400)', async () => {
    expect(await status(() => dropOff(deps, { ...base(), carrier: '   ' }))).toBe(400);
    expect(await status(() => dropOff(deps, { ...base(), carrier: 'x'.repeat(61) }))).toBe(400);
  });
  it('rejects an unknown item type (400)', async () => {
    expect(await status(() => dropOff(deps, { ...base(), type: 'boat' as never }))).toBe(400);
  });
  it('an S3 failure still records the delivery, without a photo', async () => {
    const broken: PhotoStore = { put: async () => Promise.reject(new Error('s3 down')) };
    const { deliveryId } = await dropOff({ ...deps, photos: broken }, { ...base(), photoBase64: jpeg });
    const [d] = await t.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    expect(d!.photoUrl).toBeNull();
    expect(sent[0]!.d.photoUrl).toBeUndefined();
  });
  it('an invalid photo is rejected (400) and nothing is written', async () => {
    expect(await status(() => dropOff(deps, { ...base(), photoBase64: 'data:image/png;base64,AAAA' }))).toBe(400);
    expect((await t.db.select().from(deliveries)).length).toBe(0);
  });
  it('a throwing notifier does not fail the drop-off', async () => {
    const bad: Deps = { ...deps, notify: { visitor() {}, delivery: () => { throw new Error('boom'); } } };
    await expect(dropOff(bad, base())).resolves.toHaveProperty('deliveryId');
  });
});
