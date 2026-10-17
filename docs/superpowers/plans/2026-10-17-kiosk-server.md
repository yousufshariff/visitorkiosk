# Kiosk Server, Storage, Auth and Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phase-1 kiosk runnable: a Fastify server implementing `KioskApi` over Postgres, S3 photo storage, kiosk-key auth, host CSV import, and a Vite/Tailwind build served by the same server.

**Architecture:** Thin Fastify routes validate with Zod and call services that take injected `{ db, photos, notify }`. `PhotoStore` and the notifier are interfaces, so tests use a real local Postgres plus in-memory fakes. `HttpKioskApi` is a fetch adapter that lets the unchanged client views talk to the server.

**Tech Stack:** TypeScript strict, Fastify 5, `@fastify/static`, Zod, Drizzle ORM + `pg`, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), `csv-parse`, Vite + `@vitejs/plugin-react`, Tailwind CSS, `tsx`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-kiosk-server-design.md` (phase 1 spec: `docs/superpowers/specs/2026-10-16-reception-kiosk-design.md`)

## Global Constraints

- `KioskApi` in `shared/types.ts` is the contract and does not change; wire field names follow it (`qrToken`, `visitId`, `hostId`, `recipientId`, `photoBase64`).
- All API routes under `/api`, JSON, validated with Zod; `/healthz` is public. Errors are `{ error: { code, message } }` with status 400/401/404/409/413/500; messages are safe to show on the kiosk.
- Auth: header `x-kiosk-key`, compared in constant time against SHA-256 hashes in `KIOSK_KEY_HASHES` (comma-separated). Missing or wrong → 401.
- Photos: only `data:image/jpeg;base64,`; JPEG magic bytes `FF D8 FF`; ≤ 2 MB decoded; keys `visits/<uuid>.jpg` and `deliveries/<uuid>.jpg`; presigned GET URL, expiry 7 days (604800 s).
- A photo failure (S3 down) never fails a check-in or drop-off: it succeeds with no photo and logs a warning. An invalid photo payload is a 400/413 and nothing is written.
- Notifications are fired after commit, not awaited, never fail the request; fallback rule from phase 1 (`server/notifications.ts`) is unchanged.
- No webhook URL, email or phone is ever returned in a response; logs never contain webhook URLs or photo data.
- Env: `DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, AWS default credential chain, `KIOSK_KEY_HASHES`, optional `SLACK_FALLBACK_WEBHOOK`, `TEAMS_FALLBACK_WEBHOOK`, `PORT`; the key is injected into the client as `VITE_KIOSK_KEY`.
- Host CSV columns: `name,email,department,slack_user_id,slack_webhook_url,teams_webhook_url`; upsert by email; bad rows skipped and reported with line numbers; exit non-zero if any failed.
- `db/schema.sql` remains the source of truth; strict TypeScript, no `any`; Node 20.

## Review Focus

- Photo that is not JPEG, is not valid base64, or exceeds 2 MB: 400/413, no S3 write, no DB row.
- Two kiosks checking in the same email at once: both succeed (upsert), no unique-violation 500.
- QR token scanned twice or after check-out/cancel: 409, and no second notification.
- Unknown or inactive host id on check-in or drop-off: 404, and no visitor row is left behind (single transaction).
- Search text containing `%`, `_` or a very long string: matched literally, `q` capped at 100 chars, results capped at 10.
- S3 or webhook down or slow: response still succeeds promptly.

---

### Task 1: Dependencies, config and test database harness

**Files:**
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `server/config.ts`, `server/config.test.ts`, `server/testing/pg.ts`, `server/testing/globalSetup.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` where `Config = { databaseUrl: string; s3Bucket: string; s3Region: string; kioskKeyHashes: string[]; slackFallbackUrl?: string; teamsFallbackUrl?: string; port: number }`; throws listing every missing/invalid variable.
- Produces: `testing/pg.ts` exports `freshDb(): Promise<{ db: Db; pool: Pool; close(): Promise<void> }>` which creates a new empty database from `db/schema.sql` on the local Postgres 16 (same cluster/port 54329 as `db/schema.test.sh`), one database per test file.

- [ ] **Step 1:** Add the dependencies listed in Tech Stack (runtime: fastify, @fastify/static, zod, drizzle-orm, pg, AWS SDK packages, csv-parse; dev: vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, tsx, @types/pg) and scripts `dev:server`, `build`, `start`, keeping `test` and `typecheck`.
- [ ] **Step 2: Write failing tests** in `server/config.test.ts`: `loadConfig` parses a full env; defaults `port` to 3000; splits `KIOSK_KEY_HASHES` on commas and trims; throws an error whose message names every missing required variable at once (`DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, `KIOSK_KEY_HASHES`); rejects a non-numeric `PORT`.
- [ ] **Step 3:** Run `npx vitest run server/config.test.ts` → FAIL (module missing).
- [ ] **Step 4:** Implement `server/config.ts` with Zod.
- [ ] **Step 5:** Implement `testing/pg.ts` and a Vitest `globalSetup` that starts the local Postgres exactly as `db/schema.test.sh` does when not already running (skip with a clear message if `postgres` cannot be started); register it in `vitest.config.ts` and add `server/**/*.test.ts` DB tests to `include`.
- [ ] **Step 6:** Run `npx vitest run server/config.test.ts && npm run typecheck` → PASS.
- [ ] **Step 7:** Commit `feat: server deps, config and test db harness`.

### Task 2: Drizzle schema and drift test

**Files:**
- Create: `server/db/schema.ts`, `server/db/client.ts`, `server/db/schema.test.ts`

**Interfaces:**
- Consumes: `freshDb` from Task 1.
- Produces: tables `users`, `visitors`, `visits`, `deliveries` with the pgEnums `visit_status`, `delivery_status`, `delivery_type`; `type Db` (Drizzle node-postgres database); `createDb(databaseUrl: string): { db: Db; pool: Pool }`.

- [ ] **Step 1: Write failing test** `schema.test.ts`: for each table, the set of column names and `NOT NULL`-ness read from `information_schema.columns` in `freshDb()` equals the set declared by the Drizzle table (`getTableConfig`); enum labels equal the DB's `pg_enum` labels.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Implement the Drizzle schema mirroring `db/schema.sql` (citext via `customType`), and `client.ts`.
- [ ] **Step 4:** Run → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: drizzle schema with drift test`.

### Task 3: PhotoStore (memory and S3)

**Files:**
- Create: `server/photos.ts`, `server/photos.test.ts`

**Interfaces:**
- Produces:
  - `interface PhotoStore { put(kind: 'visits' | 'deliveries', dataUrl: string): Promise<{ key: string; url: string }> }`
  - `class PhotoError extends Error { status: 400 | 413; code: 'invalid_photo' | 'photo_too_large' }`
  - `parseJpegDataUrl(dataUrl: string): Buffer` (throws `PhotoError`; shared by both stores)
  - `class MemoryPhotoStore implements PhotoStore` with `objects: Map<string, Buffer>`; `url` is `memory://<key>`.
  - `class S3PhotoStore implements PhotoStore` constructed with `{ client: S3Client; bucket: string; presign?: typeof getSignedUrl }`.

- [ ] **Step 1: Write failing tests:** `parseJpegDataUrl` accepts a real tiny JPEG data URL; rejects `data:image/png;base64,...`, invalid base64, a buffer without `FF D8 FF`, and > 2 MB decoded (413 `photo_too_large`). `S3PhotoStore.put` sends one `PutObjectCommand` with `Bucket`, `Key` matching `^visits/[0-9a-f-]{36}\.jpg$`, `ContentType: image/jpeg`, and the decoded body, then returns the injected presigner's URL called with `expiresIn: 604800`; a rejected photo makes zero S3 calls.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; use `crypto.randomUUID()` for keys and a stubbed `client.send`/`presign` in tests.
- [ ] **Step 4:** Run → PASS; typecheck.
- [ ] **Step 5:** Commit `feat: photo store with jpeg validation and s3 presign`.

### Task 4: Kiosk auth hook

**Files:**
- Create: `server/auth.ts`, `server/auth.test.ts`

**Interfaces:**
- Produces: `hashKey(key: string): string` (hex SHA-256); `kioskAuth(hashes: string[]): (req: FastifyRequest, reply: FastifyReply) => Promise<void>` used as an `onRequest` hook; replies 401 `{ error: { code: 'unauthorized', message } }` and never reveals which part failed.

- [ ] **Step 1: Write failing tests** with a tiny Fastify instance: no header → 401; wrong key → 401; valid key → 200; second hash in the list (rotation) → 200; `/healthz` and non-`/api` paths are exempt; header with different length than expected does not throw (constant-time compare on equal-length digests).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with `crypto.timingSafeEqual` over hashed values. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: kiosk api key auth`.

### Task 5: Error model and hosts service

**Files:**
- Create: `server/errors.ts`, `server/services/hosts.ts`, `server/services/hosts.test.ts`

**Interfaces:**
- Produces: `class AppError extends Error { status: number; code: string }`; `type Deps = { db: Db; photos: PhotoStore; notify: Notifier; now?: () => Date }`; `type Notifier = { visitor(a: VisitorArrival, t: NotificationTarget): void; delivery(d: DeliveryArrival, t: NotificationTarget): void }` (fire-and-forget); `searchHosts(deps: Deps, q: string): Promise<Host[]>`.

- [ ] **Step 1: Write failing tests** against `freshDb()`: matches by case-insensitive substring of `full_name`; excludes `is_active = false`; max 10 results ordered by name; `q` of `%` or `_` matches only names containing that literal character; `q` longer than 100 chars is truncated (no error); returned objects have exactly `id`, `fullName`, `department?` (no email/webhooks).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with escaped `ILIKE` (`\` escape). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: hosts search service`.

### Task 6: Visits service

**Files:**
- Create: `server/services/visits.ts`, `server/services/visits.test.ts`

**Interfaces:**
- Consumes: `Deps`, `AppError` (Task 5); `PhotoStore` (Task 3).
- Produces: `checkIn(deps, input: CheckInInput): Promise<{ visitId: string }>`; `scanCheckIn(deps, qrToken: string): Promise<{ visitorName: string; hostName: string }>`; `checkOut(deps, input: { qrToken?: string; visitId?: string }): Promise<void>`; `searchOnSite(deps, q: string): Promise<{ visitId: string; visitorName: string }[]>`.

- [ ] **Step 1: Write failing tests** (real DB, `MemoryPhotoStore`, recording `Notifier`):
  - `checkIn` creates visitor + visit with status `checked_in`, `checked_in_at` set, unique `qr_token`; notifier called once with host webhooks/slack id and the photo URL; unknown or inactive `hostId` → `AppError` 404 and zero rows in `visitors`; neither email nor phone → 400.
  - Same email checked in twice, including via `Promise.all`, yields one visitor and two visits, no error; the second call updates name/company.
  - Photo store throwing a non-`PhotoError` → check-in still succeeds with `photo_url` null; a `PhotoError` → rejects with its status and writes nothing.
  - Notifier that throws does not fail `checkIn`.
  - `scanCheckIn`: `pre_booked` token → `checked_in`, returns names, notifies once; unknown token → 404; already `checked_in`, `checked_out` or `cancelled` → 409 and notifier not called again.
  - `checkOut` by `visitId` and by `qrToken` sets `status = 'checked_out'` and `checked_out_at`; repeating it is a no-op without error; unknown id → 404; neither field → 400.
  - `searchOnSite` returns only `checked_in` visits matching the name (escaped ILIKE, `q` ≤ 100, ≤ 10 rows), names only.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement in a Drizzle transaction. Visitor upsert is `INSERT ... ON CONFLICT (email) WHERE email IS NOT NULL DO UPDATE`; phone-only visitors always insert. Upload the photo before the transaction, persist the returned URL in `visits.photo_url`; call the notifier after commit inside try/catch.
- [ ] **Step 4:** Run → PASS; typecheck.
- [ ] **Step 5:** Commit `feat: visits service`.

### Task 7: Deliveries service

**Files:**
- Create: `server/services/deliveries.ts`, `server/services/deliveries.test.ts`

**Interfaces:**
- Consumes: `Deps`, `AppError`.
- Produces: `dropOff(deps, input: DeliveryInput): Promise<{ deliveryId: string }>`.

- [ ] **Step 1: Write failing tests:** inserts a `received` delivery for an active recipient and notifies once with the recipient's webhooks; unknown or inactive `recipientId` → 404, no row; carrier blank or > 60 chars → 400; invalid `type` → 400; photo failure behaviour identical to Task 6 (S3 error → saved without photo, `PhotoError` → rejected); throwing notifier does not fail the drop-off.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: deliveries service`.

### Task 8: Fastify app and routes

**Files:**
- Create: `server/app.ts`, `server/app.test.ts`, `server/routes.ts`

**Interfaces:**
- Consumes: services (Tasks 5–7), `kioskAuth` (Task 4).
- Produces: `buildApp(opts: { deps: Deps; keyHashes: string[]; staticDir?: string }): FastifyInstance`. Routes: `GET /healthz`; `GET /api/hosts?q=`; `POST /api/visits`; `POST /api/visits/scan` body `{ qrToken }`; `POST /api/visits/checkout` body `{ qrToken?, visitId? }`; `GET /api/visits/on-site?q=`; `POST /api/deliveries`. Response bodies are exactly `KioskApi`'s return types.

- [ ] **Step 1: Write failing tests** with `app.inject`, real DB, `MemoryPhotoStore`, valid key header:
  - Each route returns the `KioskApi` shape and 200; invalid body → 400 `{ error: { code: 'invalid_request' } }`; `AppError` statuses pass through; unexpected exceptions → 500 with a generic message (no stack, no SQL).
  - All `/api/*` routes → 401 without the key; `/healthz` → 200 without it.
  - Body limit allows a 2 MB photo (about 2.8 MB base64) but returns 413 above 4 MB.
  - No response body from any route contains `@`, a webhook URL, or a phone number from the seeded host.
  - With `staticDir` set: `GET /` serves `index.html`; an unknown non-`/api` path returns `index.html`; an unknown `/api` path returns 404 JSON.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with Zod schemas per route and a Fastify `setErrorHandler`; `bodyLimit` 4 MB. **Step 4:** Run → PASS; typecheck.
- [ ] **Step 5:** Commit `feat: fastify app, routes and static serving`.

### Task 9: Server entry point

**Files:**
- Create: `server/main.ts`, `server/notifier.ts`, `server/notifier.test.ts`

**Interfaces:**
- Produces: `createNotifier(opts: NotifyOptions): Notifier` wrapping `notifyVisitorArrival`/`notifyDelivery` without awaiting and swallowing rejections; `main.ts` wires `loadConfig`, `createDb`, `S3PhotoStore`, `buildApp` (static dir `dist/client`), listens on `0.0.0.0:PORT`, and closes pool and server on SIGTERM.

- [ ] **Step 1: Write failing test:** `createNotifier(...).visitor(...)` returns synchronously (before a slow fake `fetchImpl` resolves) and a rejecting fetch produces no unhandled rejection.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement both files. **Step 4:** Run → PASS; `npx tsx server/main.ts` with an env missing variables exits non-zero and prints all missing names.
- [ ] **Step 5:** Commit `feat: server entry point and notifier`.

### Task 10: Host CSV import

**Files:**
- Create: `scripts/import-hosts.ts`, `scripts/import-hosts.test.ts`

**Interfaces:**
- Produces: `importHosts(db: Db, csv: string): Promise<{ upserted: number; errors: { line: number; message: string }[] }>`; CLI `tsx scripts/import-hosts.ts users.csv` using `DATABASE_URL`, exit code 1 if `errors.length > 0`.

- [ ] **Step 1: Write failing tests:** a valid file upserts rows and a second run with a changed department updates, not duplicates (match on case-insensitive email); a row with a bad email, missing name, or a webhook URL that is not `https://` is reported with its CSV line number and skipped while other rows import; unknown extra columns ignored; header-only file → `upserted: 0`; blank optional columns store NULL; a row for an existing user sets nothing else (no deactivation).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with `csv-parse/sync` and Zod. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: host csv import script`.

### Task 11: HttpKioskApi

**Files:**
- Create: `client/HttpKioskApi.ts`, `client/HttpKioskApi.test.ts`

**Interfaces:**
- Produces: `createHttpKioskApi(opts: { baseUrl?: string; key: string; fetchImpl?: typeof fetch }): KioskApi`. Every call sends `x-kiosk-key` and JSON; non-2xx responses throw `Error` whose message is the server's `error.message` (or a generic one when the body is not the error shape); network failure throws an `Error` with a kiosk-friendly message.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl`, one per `KioskApi` method: correct method, URL (query URL-encoded), header and body; success returns the parsed body; a 409 JSON error surfaces its message; a non-JSON 502 surfaces the generic message; a rejected fetch surfaces the network message.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: http kiosk api client`.

### Task 12: Vite and Tailwind build, kiosk entry, runbook

**Files:**
- Create: `index.html`, `src/main.tsx`, `src/index.css`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `docs/deploy-and-smoke-test.md`, `.env.example`
- Modify: `package.json` scripts, `tsconfig.json` (include `src`, `vite.config.ts`)

**Interfaces:**
- Consumes: `KioskApp` (phase 1), `createHttpKioskApi` (Task 11).
- Produces: `npm run build` → `dist/client`; `main.tsx` mounts `<KioskApp api={createHttpKioskApi({ key: import.meta.env.VITE_KIOSK_KEY })} />`.

- [ ] **Step 1:** Create `index.html` with `viewport` meta (`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`), `apple-mobile-web-app-capable`, and `<div id="root">`; Tailwind content globs cover `client/**` and `src/**`; CSS sets `touch-action: manipulation` and disables text selection except inputs (`select-text`).
- [ ] **Step 2:** Implement `main.tsx` failing loudly (visible message) when `VITE_KIOSK_KEY` is empty.
- [ ] **Step 3:** Run `npm run build` → completes; `dist/client/index.html` exists and the built CSS contains a Tailwind utility used by the views (e.g. `min-h-16`). Run `npm test && npm run typecheck` → all green.
- [ ] **Step 4:** Write `docs/deploy-and-smoke-test.md`: env vars, bucket policy (private, no public ACL), generating a key and its hash (`node -e` one-liner), `import-hosts`, and a manual smoke list (check-in with photo → Slack/Teams message with image; delivery; QR scan; presigned link opens; expired link behaviour; 401 without key), marked NOT RUN. Add `.env.example`.
- [ ] **Step 5:** Start `tsx server/main.ts` against the local test Postgres with `MemoryPhotoStore`-free dev config only if S3 is reachable; otherwise record "server start verified only through app.inject tests" in the runbook.
- [ ] **Step 6:** Commit `feat: vite/tailwind build, kiosk entry and runbook`.
