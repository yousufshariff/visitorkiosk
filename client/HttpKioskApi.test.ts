import { describe, expect, it, vi } from 'vitest';
import { createHttpKioskApi } from './HttpKioskApi';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(res: () => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => res());
  const api = createHttpKioskApi({ key: 'k1', fetchImpl: fetchImpl as unknown as typeof fetch });
  const call = () => fetchImpl.mock.calls[0]!;
  return { api, fetchImpl, call };
}

describe('createHttpKioskApi', () => {
  it('searchHosts: GET with encoded query and the key header', async () => {
    const hosts = [{ id: '1', fullName: 'Hana' }];
    const { api, call } = setup(() => json(hosts));
    await expect(api.searchHosts('a&b c')).resolves.toEqual(hosts);
    expect(call()[0]).toBe('/api/hosts?q=a%26b%20c');
    expect((call()[1]!.headers as Record<string, string>)['x-kiosk-key']).toBe('k1');
    expect(call()[1]!.method ?? 'GET').toBe('GET');
  });
  it('searchOnSite: GET /api/visits/on-site', async () => {
    const { api, call } = setup(() => json([{ visitId: 'v', visitorName: 'Vic' }]));
    await expect(api.searchOnSite('vi')).resolves.toEqual([{ visitId: 'v', visitorName: 'Vic' }]);
    expect(call()[0]).toBe('/api/visits/on-site?q=vi');
  });
  it.each([
    ['checkIn', '/api/visits', { fullName: 'V', hostId: 'h', email: 'e@x.test' }, { visitId: 'v1' }],
    ['dropOff', '/api/deliveries', { carrier: 'UPS', type: 'package', recipientId: 'h' }, { deliveryId: 'd1' }],
  ] as const)('%s: POST JSON to %s', async (method, url, input, out) => {
    const { api, call } = setup(() => json(out));
    await expect((api[method] as (i: unknown) => Promise<unknown>)(input)).resolves.toEqual(out);
    expect(call()[0]).toBe(url);
    expect(call()[1]!.method).toBe('POST');
    expect((call()[1]!.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(call()[1]!.body))).toEqual(input);
  });
  it('scanCheckIn posts { qrToken }', async () => {
    const { api, call } = setup(() => json({ visitorName: 'V', hostName: 'H' }));
    await expect(api.scanCheckIn('tok')).resolves.toEqual({ visitorName: 'V', hostName: 'H' });
    expect(call()[0]).toBe('/api/visits/scan');
    expect(JSON.parse(String(call()[1]!.body))).toEqual({ qrToken: 'tok' });
  });
  it('checkOut posts the ids and resolves with nothing', async () => {
    const { api, call } = setup(() => json({ ok: true }));
    await expect(api.checkOut({ visitId: 'v' })).resolves.toBeUndefined();
    expect(call()[0]).toBe('/api/visits/checkout');
    expect(JSON.parse(String(call()[1]!.body))).toEqual({ visitId: 'v' });
  });
  it('uses baseUrl when given', async () => {
    const fetchImpl = vi.fn(async () => json([])) as unknown as typeof fetch;
    await createHttpKioskApi({ key: 'k', baseUrl: 'https://kiosk.test', fetchImpl }).searchHosts('a');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('https://kiosk.test/api/hosts?q=a');
  });
  it("surfaces the server's error message", async () => {
    const { api } = setup(() => json({ error: { code: 'already_used', message: 'That QR code has already been used.' } }, 409));
    await expect(api.scanCheckIn('t')).rejects.toThrow('That QR code has already been used.');
  });
  it('a non-JSON error response gets a generic message', async () => {
    const { api } = setup(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.searchHosts('a')).rejects.toThrow(/something went wrong/i);
  });
  it('a network failure gets a kiosk-friendly message', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.searchHosts('a')).rejects.toThrow(/connect/i);
  });
});
