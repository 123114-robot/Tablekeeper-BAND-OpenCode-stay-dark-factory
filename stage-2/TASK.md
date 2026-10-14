# Stage 2 task file — online booking and combined tables

**Owner:** Implementer seat. **Reviewer:** review seat, on completion.
**Authoritative contract:** `tablekeeper/spec/stage-2.md` in the harness package, on top of
`tablekeeper/spec/stage-1.md`. Where this file and a spec disagree, the spec wins.
**Frozen:** `stage-1/**`, `stage-3/**`, `stage-4/**`, `mandates/**`, `room.json`. Everything
this stage creates lives under `stage-2/**`.

This file records the settled implementation decisions for Stage 2. If a decision is not
settled here or in the spec, stop and take it to the Planner — do not decide it quietly
inside the diff.

---

## 1. Objective

Deliver a buildable, running service that satisfies the full official Stage 1 contract and
the official Stage 2 additions:

- combinations of two declared tables, occupied atomically for the booking's full duration;
- `available_options` on each availability slot;
- the four browser screens, with the competing-client and uncertain-outcome rules;
- continued acceptance of a Stage 1 export, so a session and its references survive import.

## 2. File scope

All under `stage-2/`:

```
src/errors.ts      error taxonomy and its HTTP mapping (adds combination_not_allowed)
src/timezone.ts    local wall time <-> instant in a named zone, DST resolution
src/auth.ts        password hashing, tokens, email validation
src/store.ts       in-memory state, fixture load, export/import (combinable, table_ids)
src/domain.ts      availability with options, reservations, amendment, atomic moves
src/routes.ts      request parsing, routing, idempotency, response shaping, screen routes
src/server.ts      entry point: listen on $PORT, graceful close
src/ui.ts          server-rendered screens and the one inline client script
test/api.test.ts   the carried-forward stage-1 acceptance suite
test/stage2.test.ts  the stage-2 combination and screen-route suite
Dockerfile         single-container build, no runtime dependencies
tsconfig.json      advisory typecheck configuration
RUN.md, README.md, TASK.md  build/run instructions, design note, this file
```

## 3. Settled decisions

**Self-contained.** The image copies `package.json` and `src` only and imports nothing
from `stage-1/`. The spec governs each stage folder on its own.

**Storage, runtime and time.** In memory, Node 24 ESM TypeScript with `erasableSyntaxOnly`
and zero runtime dependencies; local times resolve to instants in the restaurant's zone by
scanning candidates, exactly as in Stage 1.

**Combinations.** `Restaurant.combinable` is a list of unordered pairs of existing table
ids; pairs only, distinct members, no duplicate pair. A combination's capacity is the sum
of its members'. `Reservation.table_ids` is the ordered set; a legacy seeded or imported
`table_id` is read as a set of one. Responses always carry `table_ids`, and carry `table_id`
only when the set has exactly one member. A requested pair is stored in `combinable` order.

**Availability.** `available_table_ids` stays singles-only in fixture order. `available_options`
lists every single and every declared pair with `capacity >= party_size` and no overlapping
confirmed reservation on any member: singles first, then pairs in `combinable` order.

**Booking rules.** Both `table_id` and `table_ids` sent is `422 validation_failed`; a
duplicate id is `422 validation_failed`; more than two tables or an undeclared pair is
`422 combination_not_allowed`; an overlapping member is `409 table_unavailable`; a party
above the summed capacity is `422 party_exceeds_capacity`. Cancelling frees every member.

**UI.** Server-rendered HTML for `/`, `/signup`, `/login`, `/lookup`; one inline script,
no CDN, no framework, no build step. Searches are tagged with a monotonic id so a late
response never overwrites a newer grid. A `409 table_unavailable` shows `booking-error`,
refreshes availability and keeps the form and its inputs. A lost response shows nonempty
`booking-uncertain` and retries with the same idempotency key and body. The token is kept
in `localStorage`; all required `data-testid` attributes are exposed.

## 4. HTTP surface

Unchanged from Stage 1 except the additions in the spec: `/availability` slots gain
`available_options`; `POST /reservations` accepts `table_ids`; `PATCH` and
`POST /reservation-moves` accept `table_ids` per reservation; and the four screen routes
return HTML (§3.4's JSON convention governs the API, not those routes).

## 5. Tests

`test/api.test.ts` is the Stage 1 suite, carried forward unchanged, so a regression in the
older surface is caught. `test/stage2.test.ts` covers the combination model and validation,
`available_options` ordering, the create/patch/move `table_ids` paths, and that the four
screen routes answer with HTML.

## 6. Acceptance gates

```sh
# G1 — project suite, 0 failures
cd stage-2 && node --test
# G2 — harness structure/mandate check
python -m harness check "<repo>" --track tablekeeper
# G3 — official stage-1 and stage-2 suites against the built image (host mode)
python -m harness run --track tablekeeper --repo "<repo>" --stage 2 --mode host
# G4 — build and serve /health and /
docker build -t tablekeeper-stage-2 stage-2
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-2
# G5 — isolated mode; blocked on this host by a known harness Windows-path defect
python -m harness run --track tablekeeper --repo "<repo>" --stage 2 --mode isolated
```

## 7. Definition of done

- [ ] G1 passes, `tsc --noEmit` clean.
- [ ] Official Stage 1 and Stage 2 suites pass against the built image (host mode).
- [ ] `/health` returns `200 {"status":"ok"}` and `/` returns HTML from the built image.
- [ ] No runtime dependency added; no file outside `stage-2/` changed.
- [ ] Zero secrets, tokens or personal data in the diff.

## 8. Known limitations

1. **Isolated mode cannot run on this Windows host.** `harness/cli.py` passes a
   backslash-separated path (`tablekeeper\test\stage_1`) into the Linux test container, so
   pytest reports `file or directory not found` and both stages report `error`. This is a
   harness defect, not a submission defect; the harness is read-only and was not modified.
   Host mode is the substitute, and the grading run is on Linux.
2. **No holds, deposits or waitlists.** A slot offered by search can be taken before it is
   booked; that is a correct refusal, not a defect.
