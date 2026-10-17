# Reception Kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the six phase-1 files of the reception visitor/delivery kiosk: Postgres schema, notification utility, inactivity hook, photo capture, QR scanner, and the kiosk app shell.

**Architecture:** A React kiosk SPA driven by a view-enum state machine, wrapped by an inactivity hook that resets to `welcome`. Camera components own their `MediaStream`s and always release them on unmount. A server-side `notifications.ts` builds Slack Block Kit and Teams Adaptive Card payloads and dispatches them with `Promise.allSettled`; it never throws to its caller. The kiosk talks to the API through an injected `KioskApi` interface (API routes are a follow-up plan).

**Tech Stack:** TypeScript, React 18, Tailwind CSS, Lucide, `html5-qrcode`, Vitest + @testing-library/react (jsdom), Node 20 (global `fetch`), PostgreSQL 14+.

**Spec:** `docs/superpowers/specs/2026-10-16-reception-kiosk-design.md`

## Global Constraints

- Inactivity timeout: 45 000 ms; activity events throttled to at most one timer reset per second.
- Activity events: `touchstart`, `pointerdown`, `click`, `scroll`, `keydown`.
- Camera: `getUserMedia({ video: { facingMode: 'user' } })`; `<video>` has `playsInline`, `muted`, `autoPlay`; output is JPEG Base64 (data URL), longest edge ≤ 1280 px, quality 0.8; preview mirrored, output not mirrored; tracks stopped on unmount.
- Webhooks: 5 000 ms timeout, one retry on network error or 5xx, `Promise.allSettled`, failures logged and never thrown.
- Teams payload: `{ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: <AdaptiveCard> }] }`.
- Slack payload: Block Kit with `header` block, `section` with `fields`, and an `image` accessory on a section.
- Views: `'welcome' | 'checkin' | 'quick-scan' | 'checkout' | 'delivery'`.
- Delivery types (DB enum `delivery_type`): `package, envelope, pallet, food, flowers, other`.
- All code fully typed; `strict: true`; no `any`.

## Review Focus

- Visitor name or company containing Slack/Teams markup (`<!channel>`, `&`, `<`, `>`): payloads must escape it so it cannot ping a channel or break formatting.
- Host with no personal webhook, or no webhook at all: fall back to the global webhook; if none, skip silently without throwing.
- Webhook endpoint returns 500 or hangs: one retry, then give up; the caller still resolves.
- Camera permission denied or no camera: `PhotoCapture` shows an error state and fires `onError`, and does not leave a half-open stream.
- Same QR code scanned repeatedly in quick succession: `onScan` fires once until the scanner is restarted.
- Inactivity timeout fires while a camera view is open: the stream is released and state is cleared.
- Very long names/company strings: Slack text truncated to its limits, Teams card still valid.

---

### Task 1: Schema verification

**Files:**
- Verify: `db/schema.sql` (already drafted)
- Create: `db/schema.test.sh`

**Interfaces:**
- Produces: tables `users`, `visitors`, `visits`, `deliveries`; enums `visit_status`, `delivery_status`, `delivery_type`.

- [ ] **Step 1: Write `db/schema.test.sh`** that starts a throwaway `postgres:16` container, applies `schema.sql`, and asserts via `psql`: (a) inserting a visitor with neither email nor phone fails; (b) a visit with `checked_out_at < checked_in_at` fails; (c) two visitors with the same email (case-differing) fail; (d) deleting a host who has visits fails (`RESTRICT`).
- [ ] **Step 2: Run** `bash db/schema.test.sh`. Expected: every assertion prints `ok`; fix `schema.sql` for any that do not.
- [ ] **Step 3: Initialize git and commit** (`git init` in `/tmp/reception-kiosk` if needed): `git add db && git commit -m "feat: postgres schema"`.

### Task 2: Project scaffold and shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `shared/types.ts`

**Interfaces:**
- Produces (in `shared/types.ts`):
  - `type DeliveryType = 'package'|'envelope'|'pallet'|'food'|'flowers'|'other'`
  - `interface Host { id: string; fullName: string; department?: string }`
  - `interface NotificationTarget { slackWebhookUrl?: string; teamsWebhookUrl?: string; slackUserId?: string }`
  - `interface VisitorArrival { visitorName: string; company?: string; hostName: string; purpose?: string; arrivedAt: Date; photoUrl?: string }`
  - `interface DeliveryArrival { carrier: string; type: DeliveryType; recipientName: string; receivedAt: Date; photoUrl?: string }`
  - `interface KioskApi { searchHosts(q: string): Promise<Host[]>; checkIn(input: CheckInInput): Promise<{ visitId: string }>; scanCheckIn(qrToken: string): Promise<{ visitorName: string; hostName: string }>; checkOut(input: { qrToken?: string; visitId?: string }): Promise<void>; searchOnSite(q: string): Promise<{ visitId: string; visitorName: string }[]>; dropOff(input: DeliveryInput): Promise<{ deliveryId: string }> }`
  - `CheckInInput` = `{ fullName; company?; email?; phone?; hostId; photoBase64?: string }` (email or phone required); `DeliveryInput` = `{ carrier; type: DeliveryType; recipientId; photoBase64?: string }`.

- [ ] **Step 1:** Create the files with strict TS config (`"jsx": "react-jsx"`, `"lib": ["ES2022","DOM"]`), dev deps `vitest jsdom @testing-library/react @testing-library/user-event`, deps `react react-dom html5-qrcode lucide-react`; `npm test` runs `vitest run`.
- [ ] **Step 2: Run** `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3: Commit** `feat: scaffold and shared types`.

### Task 3: `server/notifications.ts`

**Files:**
- Create: `server/notifications.ts`
- Test: `server/notifications.test.ts`

**Interfaces:**
- Consumes: `NotificationTarget`, `VisitorArrival`, `DeliveryArrival` from `shared/types.ts`.
- Produces:
  - `buildSlackVisitorPayload(a: VisitorArrival, t: NotificationTarget): SlackPayload`
  - `buildTeamsVisitorPayload(a: VisitorArrival): TeamsPayload`
  - `buildSlackDeliveryPayload(d: DeliveryArrival, t: NotificationTarget): SlackPayload`
  - `buildTeamsDeliveryPayload(d: DeliveryArrival): TeamsPayload`
  - `escapeSlack(s: string): string`, `postWebhook(url: string, body: unknown, fetchImpl?: typeof fetch): Promise<void>`
  - `notifyVisitorArrival(a: VisitorArrival, t: NotificationTarget, opts?: { fallbackSlackUrl?: string; fallbackTeamsUrl?: string; fetchImpl?: typeof fetch }): Promise<void>` and `notifyDelivery(...)` with the same shape; both resolve always.

- [ ] **Step 1: Write failing tests** (Vitest, injected `fetchImpl` mock):
  - `buildSlackVisitorPayload` returns blocks `[header, section(fields), section(accessory image)]` when `photoUrl` is set and omits the image accessory when it is not.
  - `escapeSlack('<!channel> & x')` returns `'&lt;!channel&gt; &amp; x'` (only `&`, `<`, `>` are escaped, per Slack's rules; assert no raw `<!channel>` remains). Visitor-supplied fields in Slack `section` fields use `type: 'plain_text'` so mrkdwn characters like `*` are inert.
  - `buildTeamsVisitorPayload` has `type === 'message'`, one attachment with `contentType === 'application/vnd.microsoft.card.adaptive'`, and `content.type === 'AdaptiveCard'`.
  - `notifyVisitorArrival` with a 500-then-200 mock calls `fetchImpl` twice (one retry) and resolves.
  - `notifyVisitorArrival` with a permanently rejecting `fetchImpl` resolves (does not throw) after exactly two attempts per webhook.
  - Target with no URLs and no fallbacks makes zero fetch calls and resolves.
  - A fetch that never resolves is aborted after 5 000 ms (fake timers) and counts as a failed attempt.
  - Text longer than 150 chars in a Slack header is truncated to ≤150.
- [ ] **Step 2: Run** `npx vitest run server/notifications.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces above in `server/notifications.ts`; use `AbortController` for the timeout; per-host URL wins over the fallback; send to Slack and Teams in parallel with `Promise.allSettled`; log failures with `console.error`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: slack and teams notifications`.

### Task 4: `client/useInactivityTimeout.ts`

**Files:**
- Create: `client/useInactivityTimeout.ts`
- Test: `client/useInactivityTimeout.test.tsx`

**Interfaces:**
- Produces: `useInactivityTimeout(onTimeout: () => void, opts?: { timeoutMs?: number; throttleMs?: number; enabled?: boolean }): void` (defaults 45 000 and 1 000; `enabled` defaults true).

- [ ] **Step 1: Write failing tests** (fake timers, `renderHook`):
  - calls `onTimeout` once after 45 000 ms with no events.
  - a `touchstart` at 30 000 ms pushes the timeout to ~75 000 ms.
  - 100 `pointerdown` events within one second cause at most one timer reset (spy on `setTimeout`).
  - each of `touchstart, pointerdown, click, scroll, keydown` resets the timer.
  - no listeners remain and no timer fires after unmount.
  - `enabled: false` never calls `onTimeout`.
  - uses the latest `onTimeout` callback without re-subscribing listeners.
- [ ] **Step 2: Run** `npx vitest run client/useInactivityTimeout.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with a ref for the latest callback, passive listeners on `window` (`{ passive: true, capture: true }`), and a timestamp-based throttle.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: inactivity timeout hook`.

### Task 5: `client/PhotoCapture.tsx`

**Files:**
- Create: `client/PhotoCapture.tsx`
- Test: `client/PhotoCapture.test.tsx`

**Interfaces:**
- Produces: `PhotoCapture(props: { onCapture: (base64Jpeg: string) => void; onError?: (err: Error) => void; facingMode?: 'user' | 'environment'; showFaceGuide?: boolean })` (defaults `'user'`, `true`). `onCapture` receives a `data:image/jpeg;base64,...` string.

- [ ] **Step 1: Write failing tests** (mock `navigator.mediaDevices.getUserMedia` and `HTMLCanvasElement.prototype.toDataURL`):
  - calls `getUserMedia` with `{ video: { facingMode: 'user' }, audio: false }` on mount.
  - rendered `<video>` has `playsinline`, `muted`, and `autoplay` attributes.
  - clicking the capture button calls `onCapture` with the mocked data URL; canvas dimensions never exceed 1280 on the longest edge for a 1920×1080 video; `toDataURL` is called with `('image/jpeg', 0.8)`.
  - unmount calls `stop()` on every track.
  - `getUserMedia` rejecting with `NotAllowedError` shows an error message, calls `onError`, and renders no capture button.
  - after capture, a "Retake" button restarts preview with a fresh stream.
  - face guide overlay renders when `showFaceGuide` and is absent when false.
- [ ] **Step 2: Run** `npx vitest run client/PhotoCapture.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Mirror the preview with CSS `scaleX(-1)` only (draw un-mirrored to the canvas); call `video.play()` explicitly inside the effect and catch its rejection; large (≥ 64 px) touch buttons.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: photo capture component`.

### Task 6: `client/QRScanner.tsx`

**Files:**
- Create: `client/QRScanner.tsx`
- Test: `client/QRScanner.test.tsx`

**Interfaces:**
- Produces: `QRScanner(props: { onScan: (text: string) => void; onError?: (err: Error) => void; facingMode?: 'user' | 'environment'; paused?: boolean })` (default `'user'`).

- [ ] **Step 1: Write failing tests** (`vi.mock('html5-qrcode')` with a controllable fake `Html5Qrcode`):
  - starts the scanner with the given `facingMode` on mount.
  - the success callback invokes `onScan` with the decoded text.
  - two success callbacks with the same text within 3 000 ms invoke `onScan` once.
  - unmount calls `stop()` then `clear()`, and does not throw if `stop()` rejects.
  - `start()` rejecting calls `onError` and renders an error message.
  - `paused: true` stops the scanner; toggling back to false restarts it.
- [ ] **Step 2: Run** `npx vitest run client/QRScanner.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** a `<div id>` host (unique per instance via `useId`), a config of `{ fps: 10, qrbox: 280 }`, a debounce keyed on last text and timestamp, and a `running` ref so cleanup never calls `stop()` on a scanner that never started.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: qr scanner component`.

### Task 7: `client/KioskApp.tsx`

**Files:**
- Create: `client/KioskApp.tsx`, `client/views/` (one file per view: `Welcome.tsx`, `CheckIn.tsx`, `QuickScan.tsx`, `CheckOut.tsx`, `Delivery.tsx`)
- Test: `client/KioskApp.test.tsx`

**Interfaces:**
- Consumes: `useInactivityTimeout`, `PhotoCapture`, `QRScanner`, `KioskApi`, `Host`, `DeliveryType`.
- Produces: `KioskApp(props: { api: KioskApi })`; `type KioskView = 'welcome'|'checkin'|'quick-scan'|'checkout'|'delivery'`.

- [ ] **Step 1: Write failing tests** (fake `KioskApi` with `vi.fn()`s, fake timers):
  - renders `welcome` with four large buttons: Check In, I Have a QR Code, Check Out, Delivery.
  - each button navigates to its view; every non-welcome view has a visible Back/Home button.
  - 45 s with no interaction while in `checkin` (with a name typed) returns to `welcome`; returning to `checkin` shows an empty form.
  - check-in submit with neither email nor phone shows a validation error and does not call `api.checkIn`.
  - successful check-in calls `api.checkIn` with the typed values, `hostId`, and `photoBase64`, then shows a thank-you screen that auto-returns to `welcome` after 8 s.
  - `quick-scan`: a scanned token calls `api.scanCheckIn(token)` once and shows the visitor and host names; an API rejection shows the error and offers "Check in manually".
  - `delivery`: selecting a carrier, host, type, and photo enables Submit, which calls `api.dropOff` with `{ carrier, type, recipientId, photoBase64 }`.
  - `checkout`: typing a name calls `api.searchOnSite` (debounced 250 ms); tapping a result calls `api.checkOut({ visitId })`; a scanned QR calls `api.checkOut({ qrToken })`.
  - API failure during submit shows an error with Retry and keeps the entered form data.
- [ ] **Step 2: Run** `npx vitest run client/KioskApp.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `KioskApp` as a `useReducer`-style view machine with `reset()` that sets `welcome` and bumps a `sessionKey` used as React `key` on the view subtree (this clears all form state and unmounts camera components); wire `useInactivityTimeout(reset)`; Tailwind classes with ≥ 64 px touch targets; host selection via a typeahead using `api.searchHosts` (debounced 250 ms).
- [ ] **Step 4: Run** the full suite `npm test` and `npx tsc --noEmit`. Expected: all PASS, no type errors.
- [ ] **Step 5: Commit** `feat: kiosk app shell and views`.

### Task 8: iPad manual verification

- [ ] **Step 1:** Serve the app over HTTPS (e.g. `vite --host` with a local cert, or a tunnel) and open it on the iPad in Safari.
- [ ] **Step 2:** Walk this checklist and record results in `docs/ipad-checklist.md`: camera permission prompt appears once; front camera preview renders inline (no fullscreen takeover); capture + retake works; QR scan works from a printed and an on-screen code; rotation keeps the layout usable; 45 s idle during the camera view returns to Welcome and the camera indicator turns off; Guided Access holds the app in front.
- [ ] **Step 3: Commit** `docs: ipad verification results`.
