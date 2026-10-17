# Reception Visitor & Delivery Kiosk — Design Spec

Date: 2026-10-16 · Status: awaiting review

## 1. Goal
An iPad kiosk at reception that logs visitors and deliveries and instantly notifies the right host in Slack and/or Microsoft Teams. Success: a visitor or courier completes any flow in about 30 seconds using large touch targets, the host receives a notification with a photo, and the kiosk always returns to a clean Welcome screen after 45 s of inactivity so no personal data lingers.

## 2. Scope
In scope: kiosk SPA, REST API, PostgreSQL schema, S3 photo storage, Slack/Teams notifications.
Out of scope (v1): admin UI, pre-booking creation UI and invitation email sending (the API accepts pre-bookings; something else creates them), multi-site support, host directory sync (hosts are seeded or imported into `users`).

## 3. Assumptions
1. Single office/reception site, internal use.
2. Each host may have a Slack and/or Teams incoming-webhook URL; a global fallback webhook exists in env config.
3. Pre-booked visits carry an unguessable `qr_token` (>=128 bits, URL-safe) which is the QR payload.
4. Photos are captured client-side as Base64 JPEG (max ~1280 px longest edge, quality 0.8) and posted to the API, which stores them in S3 and persists only the object key.
5. The iPad runs Safari in Guided Access with camera permission granted once, served over HTTPS.

## 4. Architecture
- **Kiosk SPA** (React + TS + Tailwind + Lucide + `html5-qrcode`). State machine over a view enum: `welcome | checkin | quick-scan | checkout | delivery`. No URL router (no back button on a kiosk).
- **API** (Node + TS + Fastify + Zod + Drizzle) with endpoints: `GET /hosts?q=`, `POST /visits` (walk-in check-in), `POST /visits/scan` (qr_token check-in), `POST /visits/checkout` (qr_token or visit id), `GET /visits/on-site?q=` (name search for check-out), `POST /deliveries`.
- **PostgreSQL** schema in `db/schema.sql` (users, visitors, visits, deliveries, three ENUMs).
- **S3**: private bucket; keys `visits/{id}.jpg`, `deliveries/{id}.jpg`; notifications use short-lived signed URLs.
- **Kiosk auth**: static kiosk API key sent in a header, scoped to the kiosk endpoints only.

## 5. Key behaviors
- **Order of operations on every submit:** validate → insert DB row → upload photo → update row with key → respond to kiosk → fire notifications asynchronously. A Slack/Teams outage never blocks the visitor or loses the log.
- **Notifications:** `notifyVisitorArrival()` and `notifyDelivery()` build a Slack Block Kit payload and a Teams Adaptive Card (`type: "message"` with an attachment), send with `Promise.allSettled`, 5 s timeout, one retry on 5xx/network error. Failures are logged, never thrown to the caller.
- **Inactivity:** `useInactivityTimeout(45_000, onTimeout)` listens for `touchstart`, `pointerdown`, `click`, `scroll`, `keydown`, throttled to one timer reset per second. On timeout the app returns to `welcome` and clears all form state; an unmount cleanup stops camera streams.
- **Camera (`PhotoCapture`):** `getUserMedia({video:{facingMode:'user'}})`, `<video playsInline muted autoPlay>`, face-oval overlay, canvas snapshot to Base64 JPEG, mirrored preview but un-mirrored output, retake support, and tracks always stopped on unmount.
- **QR (`QRScanner`):** wraps `html5-qrcode` with the rear/front camera chosen by prop, a single successful-scan callback with debounce, and `stop()`/`clear()` on unmount.
- **Check-out:** QR scan or typeahead name search over currently checked-in visits.
- **Delivery:** carrier chips (UPS, FedEx, USPS, DHL, Amazon, Other), host picker, type chips (`delivery_type`), package photo.

## 6. Error handling
- Camera denied/unavailable: a clear on-screen message with a "continue without photo" option for visits (photo optional, configurable), and a prompt to call reception.
- API/network failure: retry button plus a friendly message; form data is kept until the inactivity reset.
- Invalid/expired/duplicate QR: specific message and a fallback to the manual check-in flow.

## 7. Testing
- Unit: payload builders (snapshot tests against Slack/Teams schemas), inactivity hook with fake timers, Zod validators.
- API: integration tests against a throwaway Postgres.
- Manual iPad checklist: camera permission flow, rotation, Guided Access, 45 s reset mid-camera, offline webhook behavior.

## 8. Deliverables (this phase)
`db/schema.sql`, `server/notifications.ts`, `client/useInactivityTimeout.ts`, `client/PhotoCapture.tsx`, `client/QRScanner.tsx`, `client/KioskApp.tsx`.
