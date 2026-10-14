# Stage 1–4 Summary

## Stage 1 — official booking core

- Self-contained official-contract service: authentication, restaurant and availability reads, reservation create/list/get/cancel/patch, atomic move batches, and the `/_test/*` hooks.
- In-memory state, zero runtime dependencies (Node 24, ESM, TypeScript run directly); no SQLite and no build step.
- The overlap invariant is the half-open interval, enforced per table in one synchronous commit; ten racing clients produce exactly one `201`.
- Idempotency-key replay and conflict handling; explicit IANA-zone conversion with DST gap/overlap handling and sub-hour offsets.
- HTTP error-envelope behavior and body limits.
- Project result: 42/42 node tests passed. Official harness host mode, shipped partial suite: 120/120 PASS; isolated BLOCKED (Windows harness path-separator defect).

## Stage 2 — official combined tables and browser UI

- Self-contained official-contract service extending Stage 1 in place: declared table pairs, `available_options`, and `table_ids`/`table_id` acceptance with atomic combined bookings.
- Four server-rendered browser screens (`/`, `/signup`, `/login`, `/lookup`) on the same origin, one inline script, no CDN and no build step.
- Competing-client handling: out-of-order searches, `409` refresh-and-keep-form, and lost-response retry with the same idempotency key and body.
- In-memory state, zero runtime dependencies; accepts a Stage 1 export on import.
- Project result: 60/60 node tests passed. Official harness host mode, shipped partial suite: Stage 1 120/120 + Stage 2 25/25 PASS; isolated BLOCKED (Windows harness path-separator defect).

## Stage 3 — operational hardening

- API-key validation helpers.
- Token-bucket rate limiting.
- Structured logging with PII redaction.
- Audit trail storage.
- Migration ordering and shared-ledger checks.
- Restart-safety and timezone-suite checks.
- Project result: 54/54 tests passed.

## Stage 4 — product surface and delivery

- Responsive Setup, Search, Book, and Manage/Cancel UI.
- Same-origin frontend-to-backend proxy.
- Supervisor that starts the composed backend and frontend.
- Default-hours seeding at the composition boundary.
- Dockerfile, RUN.md, backup/restore guidance, and Playwright E2E.
- Project result: 81/81 tests; 5/5 Playwright; Docker build/run smoke passed.

## Boundary

These stage names describe the team implementation. They do not map one-to-one to the current official Tablekeeper Stage 1–4 contracts; see `SUBMISSION_COMPLIANCE.md`.
