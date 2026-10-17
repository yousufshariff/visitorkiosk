import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from './deps';
import { checkIn, checkOut, scanCheckIn, searchOnSite } from './services/visits';
import { dropOff } from './services/deliveries';
import { searchHosts } from './services/hosts';

const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).optional();

const searchQuery = z.object({ q: z.string().max(500).default('') });

const checkInBody = z.object({
  fullName: text(200),
  company: optText(200),
  email: optText(254),
  phone: optText(40),
  hostId: text(64),
  photoBase64: optText(3_500_000),
});
const scanBody = z.object({ qrToken: text(200) });
const checkoutBody = z.object({ qrToken: optText(200), visitId: optText(64) });
const deliveryBody = z.object({
  carrier: text(200),
  type: z.enum(['package', 'envelope', 'pallet', 'food', 'flowers', 'other']),
  recipientId: text(64),
  photoBase64: optText(3_500_000),
});

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/healthz', async () => ({ ok: true }));

  app.get('/api/hosts', async (req) => searchHosts(deps, searchQuery.parse(req.query).q));
  app.get('/api/visits/on-site', async (req) => searchOnSite(deps, searchQuery.parse(req.query).q));

  app.post('/api/visits', async (req) => checkIn(deps, checkInBody.parse(req.body)));
  app.post('/api/visits/scan', async (req) => scanCheckIn(deps, scanBody.parse(req.body).qrToken));
  app.post('/api/visits/checkout', async (req) => {
    await checkOut(deps, checkoutBody.parse(req.body));
    return { ok: true };
  });
  app.post('/api/deliveries', async (req) => dropOff(deps, deliveryBody.parse(req.body)));
}
