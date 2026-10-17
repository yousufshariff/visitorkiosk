# iPad verification checklist

Status: **NOT RUN** — needs a physical iPad. Fill in the results column and commit.

Setup: serve the built app over **HTTPS** (Safari blocks `getUserMedia` on plain http except localhost), open it in Safari on the iPad, then enable Guided Access (Settings → Accessibility → Guided Access) for the kiosk session.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | First launch of Check In → photo step | Camera permission prompt appears once; after Allow it does not reappear on later visitors | |
| 2 | Front-camera preview | Renders inline in the page (no fullscreen takeover), mirrored like a mirror | |
| 3 | Take photo, then Retake | Still image shown; Retake restarts the preview; the saved photo is **not** mirrored (text in frame reads correctly) | |
| 4 | Camera indicator | Green dot disappears after capturing and after leaving the photo step | |
| 5 | Check in end to end | Host receives the Slack/Teams notification with the photo | |
| 6 | QR scan (printed code) | Pre-booked code checks in within ~2 s; the same code held in view does not submit twice | |
| 7 | QR scan (code on a phone screen) | Same as above | |
| 8 | Check Out by name and by QR | Visit is closed; second attempt shows a clear message | |
| 9 | Delivery drop-off | All of carrier, recipient, type and photo needed before Drop off enables; recipient is notified | |
| 10 | Rotate portrait ↔ landscape | Layout stays usable; no horizontal scroll; camera keeps working | |
| 11 | Idle 45 s on the photo step | Returns to Welcome, camera indicator goes off, form is empty on re-entry | |
| 12 | Permission denied (Settings → Safari → Camera → Deny) | Clear message; “Continue without photo” works for check-in and Drop off | |
| 13 | Touch targets | Every button comfortably tappable with a thumb; no accidental double-tap zoom | |
| 14 | Guided Access | Home button / swipe gestures cannot leave the app | |
