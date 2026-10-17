# Stage 3 Official Validation Evidence

Seat: `@deba37f95/implementer` (build). Workspace `C:\Users\deba3\band-work\submission-review`,
branch `fix/stage3-band-official-compliance`, HEAD `a257d9a4f988b3c7bca7b4d1fb055e9781171191`.
Harness pinned checkout `C:\Users\deba3\OneDrive\文件\ChatGPT\BAND Hack\official-harness-review`
at `803560d2a678ace1414465c098eb0ab5380ffade`.

Session/model report: OpenCode session `ses_ebfdff61bffezciCQ5GGgiIj23`, provider `opencode`,
model `big-pickle` (model id `opencode/big-pickle`). The frozen mandate text names *Kimi
(Featherless)* while the runtime is `opencode/big-pickle` - recorded as a formal evidence gap,
not resolved here.

**Verdict up front.** Blocks 1-5 and the Docker smoke transcript PASS. **Block 5 (G6, host-mode
official harness run) returns exactly the Planner's predicted line: stages 1-3 pass, stage-4
overshoot fail, `claimed stage: 3 on the shipped checks`** - this is the harness's own directional
signal, never claimed as the official grading pass. Block 6 (G7, isolated-mode `--all`) remains
**BLOCKED / UNVERIFIED** by the Windows-to-Linux path issue. Host/project tests are
implementation evidence only.

---

## Reconciliation with Planner message 2/3 (D1-D9, G1-G9) - applied before this evidence

Planner's binding decisions arrived after the first green build. Three deltas were found and
fixed; the full suite and the harness were re-run on the fixed code.

1. **D1 check order (FIXED).** `PATCH` and per-move checks ran `409 reservation_cancelled`
   *before* the `422` expected_revision check. Reordered in both places to D1's chain:
   `404 owner -> 422 bad expected_revision type/range -> 409 reservation_cancelled ->
   409 stale_revision -> 409 cutoff_passed -> field validation -> occupancy`. Owner resolution
   for a whole moves batch stays global-first (stage-2's compliant baseline), the
   within-move sequence now matches D1.
2. **D7 detail shape (FIXED).** `GET /restaurants/{id}` did not carry `manager_user_ids`.
   Added `manager_user_ids` (always present, `[]` default) following the stage-1 -> stage-2
   additive pattern (stage-2 added `combinable` the same way).
3. **D3 verified (no change needed).** Policy `POST` order is `401 -> 400 parse -> 400 missing
   idempotency key -> 404 -> 403 -> 422`, which satisfies D3's `401 -> 404 -> 403` chain and
   mirrors frozen stage-1's replay-rule placement (`requireUser`, then parse, then key, then op).
4. **D2, D4, D5, D6, D8, D9 verified against the build - already conforming** (history `at`
   formatting; synthesized `created` entries; literal-`true` explain; internal revision counter;
   pair<->single `table_ids` history; fixture-duration booking).
5. Two acceptance tests were added pinning D1's precedence and D7's detail shape; the suite is
   now 92 tests.

## D1-D9 conformance map (binding Planner decisions)

| # | Ruling | Conformance | Where + pin |
|---|---|---|---|
| D1 | PATCH/move order: 404 owner -> 422 bad expected_revision -> 409 cancelled -> 409 stale -> 409 cutoff -> field validation -> occupancy; same per move in a batch, global occupancy last | Conforming | `domain.ts` `patchReservation` + the per-move loop (reordered). Owner resolution stays global-first per batch (stage-2 baseline). Pin: test `D1 order on a cancelled booking...`; container checks 422-beats-cancelled and cancelled-beats-stale |
| D2 | History `at` = operation time in the restaurant's offset; seed/import-created entries use the record's `created_at` | Conforming | `domain.ts`/`history.ts` append `formatZoned(at_ms, tz)`; seeded/imported entries at `created_ms`. Evidence: original smoke `at=2026-10-15T18:42:25+02:00`; seq/at-order tests |
| D3 | Policy POST RBAC order 401 -> 404 -> 403; GET policies public (404 unknown) | Conforming | `routes.ts` policy POST: `requireUser` 401 -> parse 400 -> idempotency-key 400 -> `publishPolicy` 404 -> 403 -> 422. Planner ruling 1 confirms the parse/key placement per stage-1 §7 (idempotency resolved before resource checks). Pins: policy RBAC tests; reviewer smoke |
| D4 | Seeded + stage-1/2-imported reservations get one synthesized `created` entry (seq 1, from-null, rev 1, policy-0 terms) at `created_at`; no synthesized `cancelled` even when seeded cancelled; stage-3 exports carry explicit histories restored verbatim | Conforming | `store.ts` seed/import readers synthesize the `created` entry and keep status without a `cancelled` entry. Pin: export/import round-trip test + legacy stage-2 import test |
| D5 | Repeated `explain`: first occurrence decides; anything but the exact string `true` is 422 | Conforming | `routes.ts` `availabilityQuery` uses `searchParams.get` (first value); `availability` rejects non-`true`. Pin: test over `['false','1','','yes','TRUE']` -> 422 |
| D6 | Restaurant revision is internal; +1 once per series adoption and once per moves batch; policy publication does NOT increment | Conforming | `store.ts` `Restaurant.revision`; `domain.ts` adoption + `applyMoves` increment; `publishPolicy` does not. Revision is exported/imported, never in a response |
| D7 | `GET /restaurants/{id}` includes `manager_user_ids`; availability/booking never use it | Conforming (fixed) | `domain.ts` `getRestaurant` adds `manager_user_ids`, additive after stage-2's `combinable`; RBAC reads `restaurant.manager_user_ids` only. Pin: `restaurant detail is the fixture shape...`; container check `manager_user_ids=[u_ada]` |
| D8 | Pair<->single amendments record `table_ids` before/after lists; single->single keeps `table_id` | Conforming | `history.ts` change-field selection. Pin: pair-history test; reviewer smoke (pair history `table_ids`) |
| D9 | Seeded bookings' duration remains the fixture duration (= policy 0), unchanged from stage-2 | Conforming | Seeded reservations retain fixture duration; import keeps policy-0 terms. Pin: seeded/import tests |

## Block 1 - stage-3 build, typecheck, tests (G2)

Command (cwd `stage-3/`):
```sh
npm install
npm run typecheck
npm test
```
Verbatim output (tail, post-reconciliation):
```
> tablekeeper-stage-3@0.1.0 typecheck
> tsc --noEmit
(no diagnostics - clean)
exit=0
tests 92
pass 92
fail 0
cancelled 0
```
`tsc --noEmit` clean; `node --test` runs `test/api.test.ts` (stage 1), `test/stage2.test.ts`
(stage 2) and `test/stage3.test.ts` (stage 3) in one pass: **92/92 pass, 0 fail** (the two new
tests are the D1-order and D7-detail pins).

## Block 2 - carried-forward stage-1 and stage-2 regression (G3)

Commands (frozen dirs, run only - never modified):
```sh
cd stage-1 && npm test    # tests 42 / pass 42 / fail 0
cd stage-2 && npm test    # tests 60 / pass 60 / fail 0
```
Both frozen suites remain green with no edit to `stage-1/` or `stage-2/`.

## Block 3 - Docker build, run, /health, smoke transcript (G4)

Original full smoke (pre-reconciliation code) recorded the complete G4 sequence - reset 204,
explain=true availability (t_1 fails `capacity`, t_2/t_3 available, fixture order, both rules),
publish-policy -> `policy_version 1`, create -> reference `09SN1K` revision 1 with
`accepted_terms.policy_version 1`, history -> created entry with three from-null changes,
decision -> same terms, adopt-series -> 3 occurrences 2030-06-10/17/24 19:00 `exception:false`,
GET series.

**Post-reconciliation refresh on final code** (rebuild + targeted D1/D7 checks; same image,
same endpoints):
```
build_exit=0
health_status=200 body={"status":"ok"} (tries=1)
reset: HTTP 204 (fixture via curl -d @file)
login: 200 token acquired
detail D7: manager_user_ids=[u_ada] slot_minutes=30 combinable_pairs=2
create: 201 reference=U7S7JR revision=1 policy_version=0 accepted_terms{...} (fixture policy 0)
cancel: status=cancelled revision=2
D1 422-beats-cancelled: {"error":{"code":"validation_failed",...}}|422
D1 cancelled-beats-stale: {"error":{"code":"reservation_cancelled",...}}|409
container_removed=True
```
Both D1 precedence cases behave as the binding order requires on the containerized final code.

## Block 4 - official harness static check (G5)

Command (cwd the pinned harness checkout):
```powershell
$env:PYTHONUTF8='1'; python -m harness check "C:\Users\deba3\band-work\submission-review" --track tablekeeper
```
Verbatim output:
```
ok - gates 1, 2 and the mandate part of gate 4 pass. Not checked here: gate 3 (stage-1/ builds and serves /health). Run: python -m harness run --track tablekeeper --repo 'C:\Users\deba3\band-work\submission-review' --stage 1 --mode isolated
```

## Block 5 - official harness run, stage 3, HOST MODE (G6)  =>  PASS (directional)

Command, exactly as G6 specifies (no `--mode` flag; host is the harness default):
```powershell
$env:PYTHONUTF8='1'; python -m harness run --track tablekeeper --repo "C:\Users\deba3\band-work\submission-review" --stage 3 --out <fresh-dir>
```
Verbatim output:
```
building C:\Users\deba3\band-work\submission-review\stage-3 ...
  stage 1: pass  (log: ...\harness-s3-host-20261016-041123\stage-1.log)
building upgrade source C:\Users\deba3\band-work\submission-review\stage-1 ...
  stage 2: pass  (log: ...\harness-s3-host-20261016-041123\stage-2.log)
building upgrade source C:\Users\deba3\band-work\submission-review\stage-2 ...
  stage 3: pass  (log: ...\harness-s3-host-20261016-041123\stage-3.log)
  stage 4: fail  (log: ...\harness-s3-host-20261016-041123\stage-4.log)
highest contiguous stage: 3
claimed stage: 3 on the shipped checks
report: C:\Users\deba3\AppData\Local\Temp\harness-s3-host-20261016-041123\report.json
NOTE: this run only includes a portion of the full tests that are applied before judging; this is meant to provide directional feedback, and ultimately you may not pass the stage with the full set of tests.
```
`report.json` (path above):
```json
"revision": "a257d9a4f988b3c7bca7b4d1fb055e9781171191",
"run_id": "00ff23694a0e45f68e6083abd255fd45",
"mode": "host",
"provenance": "working-tree",
"suite_digest": "b302bbb7bae6b8ee9e76d24ad7a6131a6a55c8cf01becee3a8cbe849c6c6a8f3",
"highest_contiguous": 3,
"claimed_stage": 3,
"stages": { "1": "pass", "2": "pass", "3": "pass" },
"checks": {
  "1": { "collected": 120, "passed": 120, "failed": 0 },
  "2": { "collected": 25,  "passed": 25,  "failed": 0 },
  "3": { "collected": 7,   "passed": 7,   "failed": 0 }
}
```
Details:
- Stage-1 suite against the stage-3 service: **120/120** across all six files.
- Stage-2 suite: **25/25** (`test_sample.py` 8, `test_ui.py` 17).
- Stage-3 suite: **7/7** (`test_sample.py` - the shipped sample; the suite itself notes it is
  "roughly a fifth of what is run").
- Stage 4 fails as the expected **overshoot**: the stage-4 suite targets a stage-4 build; a
  stage-3 service does not implement `replans`. G6 predicted exactly this line.
- In host mode the harness runs pytest on the Windows host against the container's published
  port (`stage-3.log` shows a Windows-path pytest target), so the isolated-mode path issue
  (Block 6) does not apply here.
- The harness's own NOTE stands: this is **directional feedback on the shipped checks, never an
  official pass.**

## Block 6 - official harness run, --all --mode isolated (G7)  =>  BLOCKED / UNVERIFIED

Command:
```powershell
$env:PYTHONUTF8='1'; python -m harness run --track tablekeeper --repo "C:\Users\deba3\band-work\submission-review" --all --mode isolated --out <fresh-dir>
```
Verbatim output (the two distinct blockers):
```
harness could not complete: docker build failed:
#5 [internal] load build context
#5 transferring context: 2B 0.0s done
#7 [3/9] COPY stage-1/package.json ./stage-1/package.json
#7 ERROR: ... "/stage-1/package.json": not found
#10 [8/9] COPY stage-4/deploy/ ./stage-4/deploy/
#10 ERROR: ... "/stage-4/deploy": not found
ERROR: failed to build: ... "/stage-4/deploy": not found
stage-1/ ... stage 1: error
stage-3/ ... stage 1: error / stage 2: error / stage 3: error
stage-4/ ... highest contiguous stage: 0 / claimed stage: none
summary: C:\Users\deba3\AppData\Local\Temp\harness-all-20261016-034553\summary.json
```
`summary.json`: all four folders `claimed: false`, `share: 0.0`, `preview: true`.

Two blockers, both environmental:
1. **stage-4 combined image build fails.** The frozen `stage-4/Dockerfile` documents its own
   requirement in a comment - *`# Build (from the repository root - the only context containing
   stage-1/..stage-4/): docker build -f stage-4/Dockerfile .`* - yet the harness passed an
   effectively empty build context (`transferring context: 2B`), so every `COPY stage-*` is
   `not found`. This path does not reference `stage-3/`; it is a frozen-stage-4 / harness
   context-invocation issue, not a stage-3 defect.
2. **Every isolated-mode pytest run hits a Windows-style target inside the Linux runner
   container** (`ERROR: file or directory not found: tablekeeper\test\stage_N`), so 0 checks
   are collected. The `/work` mount itself is fine. This is the anticipated Windows-to-Linux
   path issue; it does NOT affect host-mode runs (Block 5).

An earlier `--stage 3 --mode isolated` attempt (out dir `Temp\harness-s3-20261016-034313`,
report run_id `33306f8e587243efb68a2d17966bb91f`) hit only blocker 2 - stages 1/2/3 all
`error`, collected 0 - which is why G6 specifies host mode. Both isolated results are
**BLOCKED / UNVERIFIED**; no official pass is claimed from either.

---

## Scope guard (G1)

`git status --porcelain` at handoff (only `stage-3/**` in scope + this evidence doc):
```
 M stage-3/.dockerignore
 M stage-3/Dockerfile
 M stage-3/README.md
 M stage-3/RUN.md
 M stage-3/package.json
 D stage-3/src/audit.test.ts / audit.ts (placeholder removed)
 D stage-3/src/auth.test.ts / M stage-3/src/auth.ts
 D stage-3/src/logs.test.ts / logs.ts (placeholder removed)
 D stage-3/src/migrations.test.ts / migrations.ts (placeholder removed)
 D stage-3/src/rate-limit.test.ts / rate-limit.ts (placeholder removed)
 D stage-3/src/restart.test.ts / restart.ts (placeholder removed)
 M stage-3/src/server.ts
 D stage-3/src/timezone-suite.test.ts / timezone-suite.ts (placeholder removed)
 M stage-3/tsconfig.json
?? STAGE3_OFFICIAL_VALIDATION.md
?? stage-3/src/domain.ts
?? stage-3/src/errors.ts
?? stage-3/src/history.ts
?? stage-3/src/policies.ts
?? stage-3/src/routes.ts
?? stage-3/src/series.ts
?? stage-3/src/store.ts
?? stage-3/src/timezone.ts
?? stage-3/src/ui.ts
?? stage-3/test/
```
`git status --porcelain -- stage-1 stage-2 stage-4 mandates room.json` returns **empty** - the
frozen dirs and owner files are untouched. HEAD is still `a257d9a` and nothing is committed
(working-tree diff only, per the no-commit-before-PASS rule). The committed `stage-3/` at HEAD
was a generic placeholder (`audit`, `logs`, `migrations`, `rate-limit`, `restart`,
`timezone-suite`) - not tablekeeper - and was replaced by the stage-2-carried-forward
implementation plus the stage-3 contract; this is the Planner-scoped placeholder-removal
decision, disclosed here per G8.

## Files added / removed / modified in stage-3/**

- **Copied from frozen stage-2 (carried forward):** `src/auth.ts`, `src/ui.ts`,
  `test/api.test.ts`, `test/stage2.test.ts`, `tsconfig.json`, `.dockerignore`, and the
  `package.json` / `Dockerfile` / `README.md` / `RUN.md` shells.
- **New (stage 3):** `src/policies.ts`, `src/history.ts`, `src/series.ts`,
  `test/stage3.test.ts` (32 tests).
- **Rewritten on top of stage-2:** `src/domain.ts`, `src/store.ts`, `src/routes.ts`.
- **Edited:** `src/errors.ts` (adds `stale_revision`, `already_in_series`),
  `src/server.ts` (stage-3 log line), `package.json` (name `tablekeeper-stage-3`),
  `Dockerfile`, `.dockerignore`, `README.md`, `RUN.md`.
- **Removed (stage-3 placeholder only):** `src/audit.ts`, `src/logs.ts`,
  `src/migrations.ts`, `src/rate-limit.ts`, `src/restart.ts`, `src/timezone-suite.ts`
  and their `*.test.ts`.

## Spec-interpretation points beyond the settled D1-D9

1. **Availability shape without `explain` is stage-1's shape** - no-explain slots carry
   `available_options` and no explanation fields; `explain=true` adds the `explain` array.
2. **`explain` accepts only the literal `true`.** `searchParams.get` semantics: `false`, `1`,
   `''`, `yes`, `TRUE`, and a bare `?explain` are all `422 validation_failed`; absent is normal.
3. **PATCH order (D1, post-reconciliation):** `404 owner` -> `422` bad expected_revision
   type/range -> `409 reservation_cancelled` -> `409 stale_revision` -> `409 cutoff_passed`
   -> field validation -> occupancy. Moves use the same order per move inside a batch; owner
   resolution stays global-first (stage-2 baseline) and global occupancy stays last.
4. **No-op amendment** = same canonical table *set* (a reversed pair is the same set), same
   time, same party: `200`, no revision / terms / history / end-time change; still requires
   confirmed and a passing cutoff.
5. **Real amendment** revalidates all resulting fields against the policy of the *resulting*
   date, replaces terms + end time, bumps revision once, appends one `changed` entry.
6. **Cancel:** already-cancelled is `200` no-op (no revision, no entry); otherwise accepted
   cutoff `409`, then revision `+1` + one `cancelled` entry; a series occurrence bumps the
   series revision once but sets no exception.
7. **History field naming:** `table_id` when both old and new are singletons; `table_ids` with
   complete before/after lists whenever a pair is involved (creation, pair<->single); changes
   are ordered `table`, `starts_at_local`, `party_size`; `at` is `formatZoned(at_ms, tz)`.
8. **Seeded and legacy-imported** reservations start at revision `1` under policy `0` with one
   synthesized `created` entry; a stage-3 export restores exact history / terms / `series_id`.
9. **Policy selection** = greatest `effective_from` on or before the restaurant-local start
   date, ties to the greatest `policy_version`; versions are `publications + 1` and are
   allocated only on committed writes (failed writes and replays allocate none).
10. **Accepted terms omit `effective_from`** and carry `policy_version`, `slot_minutes`,
    `reservation_duration_minutes`, `cancellation_cutoff_minutes`, `opening_hours`,
    `capacities`.
11. **POST /series order:** `401` auth -> `400` parse -> `400` missing idempotency key -> then
    within the handler: `anchor_reference` missing `422` / non-string `400` -> `count` `422` ->
    `interval_weeks` `422` -> anchor lookup `404` -> cancelled `409` -> `already_in_series`
    `409` -> accepted cutoff `409` -> plan every occurrence -> commit once (no partial series,
    no counter/idempotency claim on failure).
12. **Fixture `manager_user_ids` is declarable** (default `[]`); fixture `policies` is ignored
    as an unknown field (policies enter only via `POST`, or a full restaurant object on
    import). **Restaurant detail (`GET /restaurants/{id}`) carries `manager_user_ids`** (D7,
    additive after stage-2's `combinable`); the list endpoint keeps stage-1's
    `{id, name, timezone}` shape.
13. **GET /series/{id}, /history and /decision use optional auth** - missing or invalid token
    is `404 not_found`, never `401`, and reads are owner-only.
14. **"Restaurant revision"** is an internal `Restaurant` counter (+1 once per successful
    adoption or moves batch), exported/imported but never present in a response body.
15. **Policy POST RBAC (D3):** `401` -> (parse `400`, missing-key `400`) -> `404` unknown
    restaurant -> `403` authenticated non-manager -> `422` policy validation; unknown policy
    fields are ignored, and the parse/key placement mirrors frozen stage-1's replay rules.
