# Evidence Checklist

Legend: `[x]` verified directly, `[ ]` missing or not verified, `[!]` present with a disclosed compliance risk.

## Factory eligibility

- [x] Three distinct BAND seats: Planner, Implementer, Reviewer.
- [x] Each actual seat has a same-named generic mandate with `Harness:` and `Model:` metadata.
- [x] Complete full-room export is present as `room.json` (frozen prior room).
- [x] Official offline check reads the room successfully when Python runs in UTF-8 mode.
- [!] Mandate/model mismatch: the frozen mandates name a Kimi (Featherless) model, but the actual Stage 3 runtime is `opencode/big-pickle` for all three seats (Featherless returned HTTP 401). Logged as a formal evidence gap; mandates left frozen.
- [!] The prior room contains valid seat-to-seat handoffs, but the Stage 4 recovery included additional human continuation messages. It must not be described as a zero-intervention scored run. A new clean room `c66e0b22-5664-4e23-b8dc-46937636bb3a` was opened 2026-10-16 under a single owner dispatch; its full export is a pending owner console download and must be saved as a **new** file, never replacing `room.json`.

## Application evidence

- [x] Stage 1 project tests (official-contract suite): 42/42 (2026-10-14).
- [x] Stage 2 project tests (official-contract suite): 60/60 (2026-10-14).
- [x] Stage 3 project tests (official-contract suite): 92/92 (2026-10-16). The earlier 54/54 count was the removed pre-official placeholder modules (`audit`, `logs`, `migrations`, `rate-limit`, `restart`, `timezone-suite`) and is no longer valid.
- [x] Stage 3 typecheck (`tsc --noEmit`): clean (2026-10-16).
- [x] Stage 4 project tests: 81/81.
- [x] Stage 4 Playwright: 5/5.
- [x] Stage 4 Docker image builds and serves `/health` and `/`.
- [x] Stage 1–3 Dockerfile and RUN.md packaging is present and self-contained (Stage 3 repaired 2026-10-16 from the transitional pinned-predecessor packaging).
- [x] Official structural preflight passes with Python UTF-8 mode at official revision `803560d2a678ace1414465c098eb0ab5380ffade`.
- [x] Stage 1 Docker build and startup smoke: PASS (2026-10-14, `/health` -> `{"status":"ok"}`). Stage 2 Docker build and startup smoke: PASS (2026-10-14, `/health` -> `{"status":"ok"}`, `/` served HTTP 200). Stage 3 Docker build and startup smoke: PASS (2026-10-16, `/health` 200 on first try plus full reset/explain/policy/create/history/decision/series smoke).
- [!] Official isolated harness: BLOCKED on this Windows host. Two preserved causes: (1) isolated pytest targets are passed to the Linux runner with Windows backslashes (`ERROR: file or directory not found: tablekeeper\test\stage_N`, `harness/cli.py:89`); (2) `--all` cannot build the frozen `stage-4/Dockerfile` combined image because the harness passes an empty build context. Official harness host mode, shipped partial suite (a portion of the judge's set): Stage 1 120/120, Stage 2 25/25, Stage 3 7/7 PASS with Stage 4 overshoot fail, `claimed stage: 3` (2026-10-16, directional only, not a grading pass).
- [x] Stages 1, 2 and 3 APIs now conform to the official spec at revision `803560d2a678ace1414465c098eb0ab5380ffade`; Stage 4 is frozen and its API/UI remains an earlier iteration not repaired in this run.

## Repository integrity

- [x] Source repository, source branch, and source commit are recorded.
- [x] Full room export is retained rather than replacing it with a final response.
- [x] Tracked-secret scan passed in the source Stage 4 diff.
- [x] Frozen scope check passed: the Stage 3 change touches only `stage-3/**` and top-level compliance docs; `stage-1/**`, `stage-2/**`, `stage-4/**`, `mandates/**` and `room.json` are byte-identical (2026-10-16).
- [x] Placeholder-module removal inside `stage-3/**` is disclosed (Planner-scoped decision) in `STAGE3_OFFICIAL_VALIDATION.md` and `STAGE3_BAND_EXECUTION_REPORT.md`.
- [x] Public claims distinguish project-test evidence from official-harness evidence.
- [ ] Confirm team ownership/licensing before treating the copied team-worktree files as a standalone licensed release.

## Submission assets

- [x] Public GitHub repository exists.
- [x] Evidence branch contains code, mandates, room export, commands, and compliance report.
- [ ] Video showing the BAND room and product walkthrough.
- [ ] Slide presentation.
- [ ] Official submission form receipt.

## Known limitations (Stage 1) — follow-ups, not blockers

- [x] Reviewer observation 1: a no-op `PATCH`/move re-validates the reservation's stored start, so a no-op move on an off-grid/out-of-hours *seeded* reservation returns 422 instead of retaining the record. Reachable only with seed data outside the contract (the official `test_seeded_state.py` is 13/13). Follow-up: short-circuit an empty move or validate the seed grid at reset.
- [x] Reviewer observation 2: the idempotency record key is `(user, path, key)` without `method`. No observable difference today (only `POST` carries keys, on two distinct paths) and it matches the user-scoped intent of spec §7. Follow-up: include `method` if a same-path, multi-method keyed endpoint is added.
