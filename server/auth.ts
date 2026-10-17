import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** `onRequest` hook: every /api route needs an `x-kiosk-key` whose SHA-256 is in `hashes`. */
export function kioskAuth(hashes: string[]) {
  const allowed = hashes.map((h) => Buffer.from(h.toLowerCase(), 'hex'));
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = req.url.split('?')[0] ?? '';
    if (path !== '/api' && !path.startsWith('/api/')) return;
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
