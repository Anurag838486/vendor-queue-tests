# Test Suite — Vendor Request Queue

This adds a Jest + Supertest + jsdom test suite that reproduces every bug
found during Phase 1 QA. Every test asserts the **spec-correct** behavior,
so each one currently **fails** against the app as shipped — that failure
is the proof the bug is real. No application code was changed; only tests
were added.

## Setup

```bash
npm install
npm test
```

## Files

- `tests/api.test.js` — Supertest suite hitting the real Express server
  (`server.js`) over HTTP, using a fresh session-cookie agent per test so
  each test starts from the known seed data (via `POST /api/reset`).
  Covers all API/server-side bugs: enum validation, blank-name validation,
  whitespace trimming, wrong status code on create, mass-assignment guard
  on create, the `IN_PROGRESS` summary double-count, missing 404 handling
  for unknown ids, the state-machine skip/backward-transition bugs, invalid
  `to` values, inactive-vendor assignment, assigning to a `COMPLETED`
  request, and the `vendorId: null` unassign bug.

- `tests/app-ui.test.js` — Loads the real, unmodified `app.js` source into
  a jsdom environment (with `fetch` stubbed against an in-memory copy of
  the seed data) and calls its top-level functions directly. Covers all
  frontend bugs: inactive vendors listed in the dropdown, the dropdown not
  reflecting the real assigned vendor, the vendor-select never being
  disabled on `COMPLETED` requests, every future-state button being
  enabled instead of only the valid next one, success toasts firing on
  failed transitions/assignments, and the board not reloading after a
  successful transition.

## Notes / limitations

- I wasn't able to run `npm install` / `npm test` myself in the sandbox
  this was prepared in (no network access to the npm registry there), so
  the suite hasn't been executed end-to-end by me. It's written directly
  against the bug comments already present in `app.js`/`server.js` and
  against the confirmed manual QA findings, and it should run as-is with
  `npm install && npm test` — but please run it locally and let me know
  if anything needs adjusting.
- Fixing the bugs is optional per the assignment; these tests are written
  to fail on the current code and pass once each corresponding bug in the
  `BUG:` comments is fixed.
