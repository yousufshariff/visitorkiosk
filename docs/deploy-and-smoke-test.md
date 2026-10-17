# Deploy and smoke test

## Build and run
1. Create the database and apply the schema: `psql "$DATABASE_URL" -f db/schema.sql`
2. Generate a kiosk key and its hash (one key per iPad so a lost device can be revoked):
   ```bash
   KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
   echo "key (build-time VITE_KIOSK_KEY): $KEY"
   node -e "console.log(require('crypto').createHash('sha256').update('$KEY').digest('hex'))"   # → KIOSK_KEY_HASHES
   ```
   Rotation: add the new hash to `KIOSK_KEY_HASHES` (comma-separated), rebuild the kiosk with the new key, then remove the old hash.
3. Build the kiosk with the key: `VITE_KIOSK_KEY=<key> npm run build` (writes `dist/client`).
4. Set the env vars from `.env.example` and start: `npm start`. Serve it over **HTTPS** (iPad Safari only allows the camera on https).
5. Load hosts: `DATABASE_URL=... npm run import-hosts -- users.csv`
   (columns `name,email,department,slack_user_id,slack_webhook_url,teams_webhook_url`; bad rows are listed with line numbers and the exit code is 1).

## S3 bucket
Private bucket, "Block all public access" on, no public ACLs. The server needs `s3:PutObject` and `s3:GetObject` on the bucket (GetObject is used to sign the 7-day links). Photos are stored as `visits/<uuid>.jpg` and `deliveries/<uuid>.jpg`.

## Verified in development (automated)
- Server, services, auth, photo validation and the HTTP client: unit and integration tests against a real local Postgres 16.
- A real boot of `server/main.ts` against Postgres, the CSV import CLI, and static serving were exercised once by hand: healthz, 401 without key, host search, check-in and on-site search over HTTP.

## Manual smoke test — NOT RUN
These need real S3, Slack/Teams and an iPad, which the development environment does not have.

| # | Check | Status |
|---|---|---|
| 1 | Check in with a photo → host receives a Slack/Teams message with the photo | NOT RUN |
| 2 | The photo link in the notification opens, and the object is under `visits/` in the bucket | NOT RUN |
| 3 | Delivery drop-off with a package photo → recipient notified | NOT RUN |
| 4 | Pre-booked QR scan checks the visitor in; scanning it again shows the "already used" message | NOT RUN |
| 5 | Check-out by name and by QR | NOT RUN |
| 6 | A request without `x-kiosk-key` returns 401 (`curl -i https://<host>/api/hosts?q=a`) | NOT RUN |
| 7 | With S3 credentials removed, a check-in still succeeds (no photo) | NOT RUN |
| 8 | A link older than 7 days no longer loads (expected) | NOT RUN |
| 9 | Run `docs/ipad-checklist.md` on the physical iPad | NOT RUN |
