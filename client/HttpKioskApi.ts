import type { CheckInInput, DeliveryInput, Host, KioskApi } from '../shared/types';

const GENERIC = 'Something went wrong. Please ask reception for help.';
const OFFLINE = 'Could not connect. Please check the network or ask reception for help.';

/** `KioskApi` over the kiosk server's HTTP API; failures become Errors whose message is safe to show. */
export function createHttpKioskApi(opts: { baseUrl?: string; key: string; fetchImpl?: typeof fetch }): KioskApi {
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-kiosk-key': opts.key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(OFFLINE);
    }
    if (!res.ok) {
      let message = GENERIC;
      try {
        const j = (await res.json()) as { error?: { message?: unknown } };
        if (typeof j.error?.message === 'string' && j.error.message) message = j.error.message;
      } catch {
        /* not JSON: keep the generic message */
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }

  const q = (s: string) => encodeURIComponent(s);
  return {
    searchHosts: (s) => request<Host[]>(`/api/hosts?q=${q(s)}`),
    checkIn: (input: CheckInInput) => request('/api/visits', input),
    scanCheckIn: (qrToken) => request('/api/visits/scan', { qrToken }),
    checkOut: async (input) => {
      await request('/api/visits/checkout', input);
    },
    searchOnSite: (s) => request(`/api/visits/on-site?q=${q(s)}`),
    dropOff: (input: DeliveryInput) => request('/api/deliveries', input),
  };
}
