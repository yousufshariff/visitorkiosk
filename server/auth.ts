import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Protected means "the router will run an /api route". The matched route is the source of truth: the raw
 * URL can spell the same path differently (`/%61pi/...`), so it is only a fallback for unmatched requests.
 */
function isProtected(req: FastifyRequest): boolean {
  if (req.routeOptions?.url?.startsWith('/api')) return true;
  let path = req.url.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return true; // undecodable paths are not worth serving
  }
  path = path.toLowerCase();
  return path === '/api' || path.startsWith('/api/');
}

/** `onRequest` hook: every /api route needs an `x-kiosk-key` whose SHA-256 is in `hashes`. */
export function kioskAuth(hashes: string[]) {
  const allowed = hashes.map((h) => Buffer.from(h.toLowerCase(), 'hex'));
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isProtected(req)) return;
    const header = req.headers['x-kiosk-key'];
    const key = typeof header === 'string' ? header : '';
    const digest = createHash('sha256').update(key).digest(); // equal-length digests: safe for timingSafeEqual
    let ok = false;
    for (const a of allowed) if (a.length === digest.length && timingSafeEqual(a, digest)) ok = true;
    if (!ok) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'This kiosk is not authorised. Please ask reception for help.' } });
    }
  };
}
