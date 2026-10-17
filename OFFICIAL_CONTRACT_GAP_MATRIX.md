# Official Tablekeeper contract gap matrix

Official source revision: `803560d2a678ace1414465c098eb0ab5380ffade`.
Stage 3 repair executed 2026-10-16 on branch `fix/stage3-band-official-compliance`,
base HEAD `a257d9a4f988b3c7bca7b4d1fb055e9781171191`. Boxed P0 repairs for
Stages 1 and 2 were executed 2026-10-14 on the same official revision.

Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN` refer only to the
named verification. Project tests are not official harness results. Host-mode
`harness run` results are directional feedback on the shipped partial suite —
never an official grading pass. Isolated mode is `BLOCKED` on this Windows host;
see the rows below and `STAGE3_OFFICIAL_VALIDATION.md` Blocks 5 and 6.

| Area | Existing implementation before repair | Required repair | Current verification |
| --- | --- | --- | --- |
| Stage 1 packaging | Unrelated booking core importing `index.js`; no official-layout `Dockerfile` | Self-contained official-contract service plus `Dockerfile` and `RUN.md` | Structural preflight: PASS; local `/health`: PASS; Docker G4: PASS (2026-10-14) |
| Stage 1 API | Custom `/v1/restaurants` and `/v1/bookings` routes | Full official auth, restaurant, availability, reservation, move and test-state contract | Implemented; host-mode harness shipped partial suite 120/120 PASS (directional); isolated BLOCKED (`harness/cli.py:89` Windows path-separator defect) |
| Stage 2 packaging | Chronological modules importing Stage 1 from a sibling folder | Self-contained official-contract service plus `Dockerfile`, `RUN.md`, `tsconfig.json` | Structural preflight: PASS; local `/health` and `/`: PASS; Docker G4: PASS (2026-10-14) |
| Stage 2 product | Availability module and a later custom Stage 4 UI | Official browser routes, `data-testid` contract, stale/lost-response recovery, table combinations | Implemented; host-mode harness shipped partial suite Stage 1 120/120 + Stage 2 25/25 PASS (directional); isolated BLOCKED |
| Stage 3 packaging | Pre-official placeholder modules (`audit`, `logs`, `migrations`, `rate-limit`, `restart`, `timezone-suite`) with a `server.ts` importing nonexistent `../../stage-1/src/db.ts` and `../../stage-2/src/{hours,availability}.ts`; `Dockerfile` fetched a pinned old tarball of our own repo | Rebuild as stage-2 carried forward into a self-contained official-contract service with `Dockerfile` and `RUN.md`; remove the broken placeholder modules (Planner-scoped decision, disclosed) | Docker build exit 0, `/health` 200 try 1, full smoke transcript PASS; placeholder removal disclosed in `STAGE3_OFFICIAL_VALIDATION.md`; `harness check` PASS |
| Stage 3 availability explanations | None | `GET /availability?explain=true` (only literal `true`, else 422) with per-slot `explain[]`: every table once in fixture order, both rules always, `available` ⇔ both, matching `available_table_ids`, `policy_version`; stage-1 shape without `explain` | Implemented; 92/92 project tests; host-mode harness stage 3 shipped sample 7/7 PASS (directional) |
| Stage 3 reservation history | None | Owner-only `GET /reservations/{reference}/history` (404 even unauthenticated), append-only `seq` 1..n, `created` three from-null changes, `changed` only real changes in fixed order, no-op records nothing, `cancelled` last with empty changes, each entry carrying resulting `revision` + `accepted_terms` | Implemented; covered by project tests and smoke |
| Stage 3 policies | None; fixture `manager_user_ids` silently dropped; no publish/list endpoint | `manager_user_ids` fixture field (default `[]`); idempotent complete-policy `POST /restaurants/{id}/policies` with 401/404/403/422 rules, per-restaurant `policy_version` from 1 (failed writes/replays allocate none), immutable policies; public `GET .../policies` in publication order omitting policy 0 | Implemented; RBAC/versioning/validation covered by project tests |
| Stage 3 policy selection, terms and revision | None | Greatest `effective_from` ≤ local start date, ties greatest version; policy 0 = fixture rules; every reservation response carries `revision` (1 at creation) and complete `accepted_terms` (minus `effective_from`); seeded bookings revision 1 under policy 0; old idempotent replays keep original revision/terms | Implemented; covered by project tests |
| Stage 3 amendment, cancel, expected_revision | None; no `stale_revision` / `already_in_series` error codes | Cancel uses accepted cutoff, `+1` revision once; real amendment checks old accepted cutoff then validates all resulting fields against the resulting date's policy, atomically replaces terms/end, `+1` revision; no-op retains all and records nothing; optional `expected_revision` (409 `stale_revision` before cutoff/validation, 422 invalid type/range); two concurrent same-revision amendments ⇒ at most one real change | Implemented; D1 check-order reconciliation applied and pinned by tests (404 → 422 → 409 reservation_cancelled → 409 stale_revision → 409 cutoff_passed → validation → occupancy) |
| Stage 3 decision | None | Owner-only `GET /reservations/{reference}/decision` → `{reference, revision, accepted_terms}`, current incl. cancelled, 404 rule shared with history | Implemented; covered by project tests and smoke |
| Stage 3 recurring series | None | `POST /series` adoption with idempotency: anchor owned/confirmed/past accepted cutoff (404/409 `reservation_cancelled`/409 `already_in_series`); `count` 2..12, `interval_weeks` 1..4 (422); per-date policy selection, DST `invalid_local_time`, atomic all-or-nothing (no partial series/reservations/histories/counters/idempotency claim); 201 shape; `GET /series/{id}` owner-only 404; real occurrence PATCH ⇒ `exception: true` + series revision +1 once; cancel ⇒ series revision +1 once without exception; replays return original series response; adoption +1 restaurant revision once | Implemented; covered by project tests and smoke |
| Stage 3 combined-table history | None | Pair creation records `table_ids` (null → declared-order pair); any change involving a pair records complete before/after `table_ids` in declared combination order; reversed input pair is the same set, not an amendment; combination capacity = sum of the selected policy's capacities | Implemented; covered by project tests |
| Stage 3 moves under policies | None | Per-move old accepted cutoff then adopt resulting date's policy; per-move optional `expected_revision` with PATCH rules; no-op retains terms/history; all-or-nothing; each changed booking `+1` revision + one changed entry; restaurant revision +1 once per batch; each affected series `+1` once and each changed occurrence becomes a permanent exception; failed batch/replay changes nothing | Implemented; covered by project tests |
| Stage 3 upgrade/import | Stage 2 accepted stage-1 exports; no stage-3 state | Accept same-team stage-1 and stage-2 exports (revision 1, policy 0 defaults); adoption works on imported reservations; sessions, confirmation links and original booking retries remain valid; stage-3 exports additively round-trip policies, revisions, terms, histories, series, exceptions, managers and counters | Implemented; lenient export reader extended additively; covered by project tests |
| BAND autonomy | Recovery room contained human continuation messages; not eligible as zero-intervention evidence | Run a new clean room with one dispatch per stage and no intermediate steering | New clean room `c66e0b22-5664-4e23-b8dc-46937636bb3a` opened 2026-10-16 under a single owner dispatch; full-room export download is a pending owner console action; not claimed as a scored zero-intervention run until that export is preserved |
| Submission assets | Repository evidence exists | Video, slides and submission receipt | NOT RUN / MISSING |

## Standing cross-cutting notes

- **Windows UTF-8 requirement.** `python -m harness check` fails to read
  `room.json` under this host's default code page (`cp950` cannot decode the
  UTF-8 file). Prefix every harness invocation with `$env:PYTHONUTF8='1'`.
  This is a host locale issue, not a repository defect.
- **Isolated-mode blockers (preserved, not worked around).** `--all --mode
  isolated` fails for two environmental reasons: the frozen `stage-4/Dockerfile`
  combined-context build receives an effectively empty build context, and every
  isolated pytest target is passed to the Linux runner with Windows backslashes.
  Both are recorded verbatim; no harness file was modified.
- **Model/mandate mismatch (formal evidence gap).** Frozen mandates name a Kimi
  model (`providerID=featherless`, `modelID=moonshotai/Kimi-K2.5`); the actual
  runtime for all three seats this round is `opencode/big-pickle`
  (`providerID=opencode`, `modelID=big-pickle`, per `opencode.log` run
  `95cc4c71`, 2026-10-15). Verbatim: this host's runtime was `opencode/big-pickle`,
  not Kimi. Kimi appears only in older 2026-10-04 log entries; Featherless
  returned HTTP 401 in discarded attempts with no product writes. Mandates stay
  frozen as delivered.
- **Honesty statement.** The event page reports that the hackathon has finished.
  Passing the published harness after the deadline establishes technical
  compatibility only unless the organizer explicitly accepts a late or
  replacement submission.
