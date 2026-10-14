# Stage 1 task file — reservations

**Owner:** Implementer seat. **Reviewer:** review seat, on completion.
**Authoritative contract:** `tablekeeper/spec/stage-1.md` in the harness package. Where this file and
the spec disagree, the spec wins. **Plan:** `../plan.md`. **Mandate:** `../mandates/implementer.md`.

This file records the settled implementation decisions for Stage 1. If a decision is not settled here
or in the spec, stop and take it to the Planner — do not decide it quietly inside the diff.

---

## 1. Objective

Deliver a buildable, running HTTP service that seats a party at a table and **provably never
double-books a table**, under concurrent writers, duplicate request delivery and daylight-saving
transitions. Occupancy is the half-open interval `[starts_at, starts_at + reservation_duration)`, so a
90-minute booking at 19:00 does not overlap one starting at 20:30.

## 2. File scope — ours and only ours

All under `stage-1/`:

```
src/errors.ts      error taxonomy and its HTTP mapping
src/timezone.ts    local wall time <-> instant in a named zone, DST resolution
src/auth.ts        password hashing, tokens, email validation
src/store.ts       in-memory state, fixture load, export/import
src/domain.ts      availability, reservations, amendment, atomic moves
src/routes.ts      request parsing, routing, idempotency, response shaping
src/server.ts      entry point: listen on $PORT, graceful close
test/api.test.ts   stage-1 acceptance suite over the real HTTP surface
Dockerfile         single-container build, no runtime dependencies
RUN.md             build/run instructions
README.md          design note
```

Do not touch `stage-2/**`, `stage-3/**`, `stage-4/**`, `mandates/**` or `room.json`.

## 3. Settled decisions

**Runtime.** Node 24, ESM, TypeScript with `erasableSyntaxOnly`. No build step. Zero runtime
dependencies: `node:http`, `node:test`, `node:assert`, `node:crypto` and the platform `Intl` zone data
are enough. Node runs the `.ts` sources directly.

**Storage is in memory.** State lives in the process. Every critical section is
synchronous, and Node runs one JavaScript thread, so no request can observe or mutate the store
between an availability check and the write it authorizes. This gives the overlap invariant without a
database file, background process or migration runner, and makes export/import an exact object round
trip. `state` in an export is this implementation's own opaque format; the spec only requires that the
same service accepts it back unchanged. (An earlier draft of this stage planned SQLite; that is
superseded — see the spec §2, which leaves storage unrestricted and does not require state to survive
a restart.)

**The guarantee.** `createReservation`, `patchReservation` and `applyMoves` fully validate, check
overlaps against every confirmed reservation on the same `(restaurant_id, table_id)`, and commit as one
synchronous step. A rejected request changes nothing.

**Time.** Local wall-clock strings are resolved to an instant in the restaurant's zone by scanning
candidate instants whose `Intl` round trip reproduces the requested wall time. Overlaps compare
instants, so a DST transition cannot create or hide a double booking. Local times in a spring-forward
gap are `422 invalid_local_time` and never appear in availability; a fall-back repeated hour resolves
to its **first** occurrence and appears **once**.

**Idempotency.** Scoped to `(user, path, key)`. Resolution happens after the body parses as a
JSON object and the caller authenticates, and **before** field validation: a used key with a different
JSON body is `409 idempotency_key_reuse` even if the new body is otherwise invalid. First use returns
the endpoint's normal `201`; a replay returns `200` with the original body verbatim. A request that
failed with 4xx does not consume the key.

**Error envelope.** `{"error": {"code": "...", "message": "..."}}`. Codes: `malformed_request` 400,
`missing_idempotency_key` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404,
`table_unavailable` 409, `email_taken` 409, `idempotency_key_reuse` 409, `cutoff_passed` 409,
`reservation_cancelled` 409, `validation_failed` 422, `not_on_slot_grid` 422, `outside_opening_hours`
422, `party_exceeds_capacity` 422, `invalid_local_time` 422, `internal` 500.

**Precedence on a booking.** Opening-window check before grid check: `17:00` is `outside_opening_hours`,
`18:01` is `not_on_slot_grid`. `party_size` below 1 or non-integer is `validation_failed`; a party over
the table's capacity is `party_exceeds_capacity`. Unknown restaurant/table, or a table of another
restaurant, is `not_found`.

## 4. HTTP surface

Unchanged from the spec: `/health`, `/_test/reset`, `/_test/export`, `/_test/import`,
`/auth/signup`, `/auth/login`, the public `GET /restaurants`, `GET /restaurants/{id}`,
`GET /availability`, and the authenticated `POST /reservations`, `GET /reservations`,
`GET /reservations/{reference}`, `POST /reservations/{reference}/cancel`,
`PATCH /reservations/{reference}`, `POST /reservation-moves`. See `spec/stage-1.md` §3–§11 for the
exact request and response shapes.

## 5. Tests

`test/api.test.ts` drives the real service on an ephemeral port and covers: health and reset
(including rejected fixtures); auth success and every failure code; public reads; the availability
grid, capacity filtering, closed days and occupancy; the create validation matrix; idempotency
(missing key, replay, reuse, another user's key, replay after cancel); list ordering and ownership;
cancel and cutoff; patch; atomic move batches (success and all-or-nothing rollback); export/import;
DST spring-forward, fall-back, first-occurrence resolution and absolute duration; and ten clients
racing one table and slot producing exactly one `201`.

## 6. Acceptance gates

```sh
# G1 — project suite, 0 failures
cd stage-1 && node --test
# G2 — harness structure/mandate check
python -m harness check "<repo>" --track tablekeeper
# G3 — official stage-1 suite against the built image
python -m harness run --track tablekeeper --repo "<repo>" --stage 1 --mode isolated
# G4 — build and serve /health
docker build -t tablekeeper-stage-1 stage-1
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-1
```

## 7. Definition of done

- [ ] G1 passes, `tsc --noEmit` clean.
- [ ] Official stage-1 suite passes.
- [ ] `/health` returns `200 {"status":"ok"}` from the built image.
- [ ] No runtime dependency added; no file outside `stage-1/` changed.
- [ ] Zero secrets, tokens or personal data in the diff.

## 8. Follow-ups (non-blocking)

1. **No-op amendment re-validates the stored start.** A no-op `PATCH`/move re-validates the
   reservation's existing `starts_at`, so a no-op move on an out-of-contract `/_test/reset` seed
   (off-grid or out-of-hours `starts_at_local`) returns `422` instead of retaining the record
   (spec §11 says a no-op move retains existing values). Reachable only with seed data outside the
   contract; the official `test_seeded_state.py` is 13/13. Candidate fix: short-circuit when a move
   supplies no fields, or validate the seed grid at reset.
2. **Idempotency key omits `method`.** The record key is `(user, path, key)` (`src/store.ts:97`)
   without `method`. No observable difference today — only `POST` carries keys, on two distinct
   paths — and it matches the user-scoped intent of spec §7. Revisit if a same-path, multi-method
   keyed endpoint is added.
