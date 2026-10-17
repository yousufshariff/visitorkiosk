# Kiosk server, storage, auth and build — design (phase 2)

Status: draft for review. Builds on phase 1 (PR #1: kiosk client, `notifications.ts`, `db/schema.sql`).

## Goal
Make the kiosk runnable on a real iPad: a Node server that implements the existing `KioskApi` contract against Postgres, stores photos in S3, authenticates the kiosk, and serves the built client over HTTPS from the same origin.

## Decisions (from brainstorming)
- One spec and one plan covering API + DB, S3, kiosk auth, and Vite/Tailwind build wiring.
- Notification photo links are **presigned S3 GET URLs, 7-day expiry** (private bucket).
- **One Fastify server** serves the API and the built kiosk (SPA fallback). Same origin, no CORS.
- Hosts are loaded by a **CSV import script** (no admin UI).

## Non-goals
Admin UI, SSO sync, photo retention/purge jobs, multi-site support.

## Architecture
Routes are thin; logic lives in services with injected dependencies `{db, photos, notify}`.

| Unit | Responsibility | Depends on |
|---|---|---|
| `server/app.ts` | Build Fastify app from injected deps; register auth, routes, static serving | all below |
| `server/db/schema.ts`, `server/db/client.ts` | Drizzle schema mirroring `db/schema.sql` (SQL file stays source of truth); client factory | pg |
| `server/services/hosts.ts` | `searchHosts` (minimal fields only) | db |
| `server/services/visits.ts` | `checkIn`, `scanCheckIn`, `checkOut`, `searchOnSite` | db, photos, notify |
| `server/services/deliveries.ts` | `dropOff` | db, photos, notify |
| `server/photos.ts` | `PhotoStore` interface; `S3PhotoStore`; `MemoryPhotoStore` for tests | AWS SDK v3 |
| `server/auth.ts` | `onRequest` hook checking `x-kiosk-key` | env |
| `scripts/import-hosts.ts` | CSV → upsert `users` | db |
| `client/HttpKioskApi.ts` | fetch adapter implementing `KioskApi` | — |
| `src/main.tsx`, `index.html`, Vite/Tailwind config | build and mount | client |

The client views are unchanged; only `main.tsx` constructs `HttpKioskApi` and passes it to `KioskApp`.

## HTTP API
All under `/api`, JSON, validated with Zod. `/healthz` is public.
- `GET /api/hosts?q=` → `Host[]` (id, display name, department only)
- `POST /api/visits` (CheckInInput) → `{visitId, qrToken, hostName}`
- `POST /api/visits/scan` `{token}` → check-in of a pre-booked visit
- `POST /api/visits/checkout` `{visitId | token}`
- `GET /api/visits/on-site?q=` → minimal on-site list
- `POST /api/deliveries` (DeliveryInput) → `{deliveryId}`
Errors: `{error:{code,message}}` with 400/401/404/409/413/500. Messages are safe to show on the kiosk.

## Behaviour
- **Check-in:** validate; upsert visitor (by email or phone); insert visit with fresh `qr_token`; upload photo; commit; then fire `notifyVisitorArrival` without awaiting.
- **Photo failure:** check-in/drop-off still succeeds with no photo; warning logged. S3 outage never turns a visitor away.
- **Photo validation:** `data:image/jpeg;base64,` only; JPEG magic bytes; ≤ 2 MB decoded; key `visits/<uuid>.jpg` or `deliveries/<uuid>.jpg`; presigned URL expiry 7 days (SigV4 maximum).
- **Scan check-in:** unknown token → 404; already checked in or cancelled/expired → 409.
- **Check-out:** sets `checked_out_at`; idempotent.
- **Notifications:** never block or fail a request; use the host's personal webhooks, falling back to global env webhooks per the phase-1 rule.
- **Privacy:** webhook URLs, emails and phone numbers never appear in any response; logs omit webhook URLs and photo data.

## Auth
`x-kiosk-key` header compared in constant time against SHA-256 hashes listed in `KIOSK_KEY_HASHES` (comma-separated, allows rotation). Missing/wrong → 401. The key is delivered to the kiosk as runtime config (`/config.js` is NOT used; the key is injected at build time via `VITE_KIOSK_KEY` for this phase). Note: a key in a client bundle is a device credential, not a secret from someone with the iPad; mitigated by HTTPS, per-device rotation, and minimal-field responses.

## Configuration (env)
`DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, AWS credentials via the default provider chain, `KIOSK_KEY_HASHES`, optional `SLACK_FALLBACK_WEBHOOK`, `TEAMS_FALLBACK_WEBHOOK`, `PORT`.

## Host import
`import-hosts users.csv` columns: `name,email,department,slack_user_id,slack_webhook_url,teams_webhook_url`. Upsert by email; invalid rows are reported with line numbers and skipped; exit non-zero if any row failed.

## Testing
- Services against the real local Postgres 16 (as `db/schema.test.sh`); no DB mocks.
- Routes via `app.inject` with `MemoryPhotoStore`.
- `S3PhotoStore` against a stubbed S3 client: key, content type, size cap, non-JPEG rejection, presign expiry.
- Auth: missing, wrong, valid, rotated key; `/healthz` exempt.
- Drizzle schema vs `db/schema.sql` drift test.
- `HttpKioskApi` contract tests; `vite build` and `tsc` clean. iPad checklist remains manual.

## Risks / open items
- Key-in-bundle trade-off above is accepted for this phase.
- Presigned links expire after 7 days; older notifications lose their image.
- Real S3 and Slack/Teams delivery cannot be verified in this environment; covered by stubs, with a manual smoke checklist added to `docs/`.
