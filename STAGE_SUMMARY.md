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

## Stage 3 — official policies, history, series and moves

- Self-contained official-contract service extending Stage 2 in place: per-slot availability explanations (`explain=true`), owner-only reservation history, policy publication with `manager_user_ids` and per-restaurant versioning, policy selection with accepted terms and revisions, decisions, recurring weekly series with exceptions, combined-table history, and moves that adopt the resulting date's policy.
- Accepts same-team Stage 1 and Stage 2 exports; revision-1 reservations default to policy 0, and stage-3 exports additively round-trip the new state.
- In-memory state, zero runtime dependencies. The pre-official placeholder hardening modules (`audit`, `logs`, `migrations`, `rate-limit`, `restart`, `timezone-suite`, and the broken `server.ts`) were removed (disclosed).
- Project result: 92/92 node tests passed with a clean `tsc --noEmit`. Official harness host mode, shipped partial suite: Stage 1 120/120 + Stage 2 25/25 + Stage 3 7/7 PASS; isolated BLOCKED (Windows harness path-separator defect plus empty Stage 4 combined-build context).

## Stage 4 — product surface and delivery

- Responsive Setup, Search, Book, and Manage/Cancel UI.
- Same-origin frontend-to-backend proxy.
- Supervisor that starts the composed backend and frontend.
- Default-hours seeding at the composition boundary.
- Dockerfile, RUN.md, backup/restore guidance, and Playwright E2E.
- Project result: 81/81 tests; 5/5 Playwright; Docker build/run smoke passed.

## Boundary

These stage names describe the team implementation. Stages 1–3 now implement the current official Tablekeeper Stage 1–3 contracts; Stage 4 remains an earlier distinct implementation that does not match the current official Stage 4 specification. See `SUBMISSION_COMPLIANCE.md`.
