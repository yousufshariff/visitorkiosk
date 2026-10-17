import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { hashKey } from './auth';
import type { Deps } from './deps';
import { MemoryPhotoStore } from './photos';
import { freshDb, type TestDb } from './testing/pg';
import { seedHost } from './testing/seed';

const KEY = 'test-kiosk-key';
const auth = { 'x-kiosk-key': KEY };
const jpegOf = (bytes: number) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes - 3, 7)]).toString('base64')}`;

let t: TestDb;
let app: FastifyInstance;
let host: Awaited<ReturnType<typeof seedHost>>;
let staticDir: string;
let visitorCalls: number;

beforeAll(async () => {
  t = await freshDb();
  staticDir = mkdtempSync(join(tmpdir(), 'kiosk-static-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>kiosk</title><div id="root"></div>');
});
afterAll(async () => {
  await app.close();
  await t.close();
});
beforeEach(async () => {
  await app?.close();
  await t.pool.query('TRUNCATE deliveries, visits, visitors, users CASCADE');
  visitorCalls = 0;
  const deps: Deps = { db: t.db, photos: new MemoryPhotoStore(), notify: { visitor: () => void visitorCalls++, delivery() {} } };
  app = buildApp({ deps, keyHashes: [hashKey(KEY)], staticDir });
  host = await seedHost(t.db, { fullName: 'Hana Host', department: 'Sales', phone: '555-0100', slackWebhookUrl: 'https://hooks.slack.test/secret' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const post = (url: string, payload: unknown, headers: Record<string, string> = auth) => app.inject({ method: 'POST', url, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = auth) => app.inject({ method: 'GET', url, headers });
const checkInBody = () => ({ fullName: 'Vic Visitor', email: 'vic@example.test', hostId: host.id });

describe('routes return the KioskApi shapes', () => {
  it('GET /api/hosts', async () => {
    const r = await get('/api/hosts?q=han');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ id: host.id, fullName: 'Hana Host', department: 'Sales' }]);
  });
  it('POST /api/visits → { visitId }', async () => {
    const r = await post('/api/visits', checkInBody());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ visitId: expect.any(String) });
    expect(visitorCalls).toBe(1);
  });
  it('POST /api/visits/scan → names', async () => {
    const [v] = (await t.pool.query("INSERT INTO visitors(full_name,email) VALUES ('Pre','p@example.test') RETURNING id")).rows;
    await t.pool.query("INSERT INTO visits(visitor_id,host_id,qr_token) VALUES ($1,$2,'tok-123')", [v.id, host.id]);
    const r = await post('/api/visits/scan', { qrToken: 'tok-123' });
    expect(r.json()).toEqual({ visitorName: 'Pre', hostName: 'Hana Host' });
    expect((await post('/api/visits/scan', { qrToken: 'tok-123' })).statusCode).toBe(409);
  });
  it('POST /api/visits/checkout and GET /api/visits/on-site', async () => {
    const { visitId } = (await post('/api/visits', checkInBody())).json();
    expect((await get('/api/visits/on-site?q=vic')).json()).toEqual([{ visitId, visitorName: 'Vic Visitor' }]);
    expect((await post('/api/visits/checkout', { visitId })).statusCode).toBe(200);
    expect((await get('/api/visits/on-site?q=vic')).json()).toEqual([]);
  });
  it('POST /api/deliveries → { deliveryId }', async () => {
    const r = await post('/api/deliveries', { carrier: 'UPS', type: 'package', recipientId: host.id });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ deliveryId: expect.any(String) });
  });
});

describe('errors', () => {
  it('invalid body → 400 invalid_request', async () => {
    const r = await post('/api/visits', { fullName: 'No Host' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_request');
  });
  it('malformed JSON → 400 in the same shape', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/visits', payload: '{oops', headers: { ...auth, 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_request');
  });
  it('AppError statuses pass through (unknown host → 404)', async () => {
    const r = await post('/api/visits', { ...checkInBody(), hostId: '00000000-0000-4000-8000-000000000000' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('not_found');
  });
  it('an unexpected failure is a generic 500 with no internals', async () => {
    await t.pool.query('ALTER TABLE visits RENAME TO visits_x');
    try {
      const r = await post('/api/visits', checkInBody());
      expect(r.statusCode).toBe(500);
      expect(JSON.stringify(r.json())).not.toMatch(/visits|relation|select|insert/i);
      expect(r.json().error.code).toBe('internal_error');
    } finally {
      await t.pool.query('ALTER TABLE visits_x RENAME TO visits');
    }
  });
  it('a 2 MB photo is accepted but a body over 4 MB is 413', async () => {
    expect((await post('/api/visits', { ...checkInBody(), photoBase64: jpegOf(2 * 1024 * 1024) })).statusCode).toBe(200);
    const r = await post('/api/visits', { ...checkInBody(), photoBase64: 'a'.repeat(4.5 * 1024 * 1024) });
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('payload_too_large');
  });
  it('a 3 MB photo is rejected 413 by the service', async () => {
    expect((await post('/api/visits', { ...checkInBody(), photoBase64: jpegOf(3 * 1024 * 1024) })).statusCode).toBe(413);
  });
});

describe('auth and privacy', () => {
  it('every /api route needs the key; /healthz does not', async () => {
    for (const [m, url] of [['GET', '/api/hosts?q=a'], ['POST', '/api/visits'], ['POST', '/api/visits/scan'], ['POST', '/api/visits/checkout'], ['GET', '/api/visits/on-site'], ['POST', '/api/deliveries'], ['GET', '/api/nope']] as const) {
      const r = await app.inject({ method: m, url, payload: m === 'POST' ? {} : undefined });
      expect(r.statusCode, `${m} ${url}`).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
  it('no response leaks host email, phone or webhook URLs', async () => {
    const bodies = [
      (await get('/api/hosts?q=hana')).body,
      (await post('/api/visits', checkInBody())).body,
      (await get('/api/visits/on-site?q=vic')).body,
      (await post('/api/deliveries', { carrier: 'UPS', type: 'package', recipientId: host.id })).body,
      (await post('/api/visits', { fullName: 'x' })).body,
    ].join('\n');
    expect(bodies).not.toMatch(/@|hooks\.slack|555-0100|secret/);
  });
});

describe('static kiosk', () => {
  it('serves index.html at / and as the fallback for unknown non-api paths', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('id="root"');
    const r = await app.inject({ method: 'GET', url: '/some/deep/link' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('id="root"');
  });
  it('an unknown /api path is a JSON 404', async () => {
    const r = await get('/api/nope');
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('not_found');
  });
});
