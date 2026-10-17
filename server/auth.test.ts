import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { hashKey, kioskAuth } from './auth';

function app(hashes: string[]) {
  const a = Fastify();
  a.addHook('onRequest', kioskAuth(hashes));
  a.get('/api/ping', async () => ({ ok: true }));
  a.get('/healthz', async () => ({ ok: true }));
  a.get('/index.html', async () => 'page');
  return a;
}
const get = (a: ReturnType<typeof app>, url: string, key?: string) =>
  a.inject({ method: 'GET', url, headers: key === undefined ? {} : { 'x-kiosk-key': key } });

describe('kioskAuth', () => {
  const hashes = [hashKey('key-one'), hashKey('key-two')];

  it('rejects a request with no key', async () => {
    const r = await get(app(hashes), '/api/ping');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });
  it('rejects a wrong key', async () => {
    expect((await get(app(hashes), '/api/ping', 'nope')).statusCode).toBe(401);
  });
  it('accepts a valid key', async () => {
    expect((await get(app(hashes), '/api/ping', 'key-one')).statusCode).toBe(200);
  });
  it('accepts any key in the list (rotation)', async () => {
    expect((await get(app(hashes), '/api/ping', 'key-two')).statusCode).toBe(200);
  });
  it('does not require a key for /healthz or non-api paths', async () => {
    const a = app(hashes);
    expect((await get(a, '/healthz')).statusCode).toBe(200);
    expect((await get(a, '/index.html')).statusCode).toBe(200);
  });
  it('handles keys of any length without throwing', async () => {
    expect((await get(app(hashes), '/api/ping', 'x'.repeat(5000))).statusCode).toBe(401);
    expect((await get(app(hashes), '/api/ping', '')).statusCode).toBe(401);
  });
  it('does not accept the stored hash itself as the key', async () => {
    expect((await get(app(hashes), '/api/ping', hashes[0])).statusCode).toBe(401);
  });
});
