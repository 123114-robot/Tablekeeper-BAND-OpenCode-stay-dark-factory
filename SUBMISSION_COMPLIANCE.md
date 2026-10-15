# Dark Factory Submission Compliance Report

Authoritative references:

- `band-ai/dark-factory-wearedevs/docs/participant-guide.md`
- Current official `tablekeeper/spec/stage-1.md` through `stage-4.md`
- Lablab event submission requirements

Official specification revision used for the compliance repair:
`803560d2a678ace1414465c098eb0ab5380ffade`.
Stage 3 official-contract repair executed 2026-10-16 on branch
`fix/stage3-band-official-compliance` (base HEAD
`a257d9a4f988b3c7bca7b4d1fb055e9781171191`). Stage 1 and Stage 2 repairs were
executed 2026-10-14 on the same revision.

## Requirement mapping

| Requirement | State | Evidence / gap |
| --- | --- | --- |
| Public GitHub repository | PASS | `123114-robot/stay-dark-factory-submission` |
| At least three BAND coding seats | PASS | Planner, Implementer, Reviewer in `room.json`; fresh seats for the Stage 3 clean room `c66e0b22-5664-4e23-b8dc-46937636bb3a` |
| Generic mandate per actual seat | PASS | `mandates/planner.md`, `implementer.md`, `reviewer.md` |
| Harness/model named in mandates | [!] | Mandates name the OpenCode adapter and a Kimi (Featherless) model. Actual runtime this run is `opencode/big-pickle` for all three seats (Planner `ses_ebfe00273ffepIjgU587Mf6yyM`, Implementer `ses_ebfdff61bffezciCQ5GGgiIj23`, Reviewer `ses_ebfdff7daffeKnHsLSa5KnAeyr`). Featherless Kimi returned HTTP 401 in discarded attempts with no product writes. Mandates remain frozen as delivered; the mismatch is a formal evidence gap, not resolved by editing them. |
| Full room export | PASS | Root `room.json` (frozen prior room). A full export of the new Stage 3 room is a pending owner Band-console action and must be saved as a **new** file, never replacing `room.json`. |
| Reciprocal seat handoffs | PASS | Prior room transcript plus the Stage 3 room record; the Stage 3 run has Planner → Implementer → Reviewer handoffs in-room. |
| One complete folder per claimed stage | PASS FOR STAGES 1–3 | Stages 1, 2 and 3 are now self-contained official-contract folders (`Dockerfile` + `RUN.md` + source, no sibling imports, no submodules). Stage 4 is frozen and was not repaired in this run. |
| Structural official preflight | PASS | `PYTHONUTF8=1 python -m harness check ... --track tablekeeper` exit 0 (`ok — gates 1, 2 and the mandate part of gate 4 pass`). Layout/provenance only; it does not build or score the services. Requires Python UTF-8 mode on this host (default `cp950` cannot decode `room.json`). |
| Clean isolated official harness | BLOCKED | Isolated mode cannot run on this Windows host: every isolated pytest target is passed to the Linux runner with backslashes (`ERROR: file or directory not found: tablekeeper\test\stage_N`), and `--all` additionally fails to build the frozen `stage-4/Dockerfile` combined image because the harness passes an empty build context. Both causes preserved verbatim. Host-mode harness on 2026-10-16 (shipped partial suite, directional only): Stages 1 120/120, 2 25/25, 3 7/7 PASS, Stage 4 overshoot fail, `claimed stage: 3`. No isolated score is claimed. |
| Current official API contract | PASS FOR STAGES 1–3 | Stages 1, 2 and 3 implement the official contract at revision `803560d2a678ace1414465c098eb0ab5380ffade`. Stage 4 was not repaired in this run and the frozen `/v1/...` history remains only inside the frozen Stage 4 folder. |
| Clean-container service start | PASS FOR STAGES 1, 2, 3, 4 | Stage 1 (2026-10-14): build exit 0, `/health` 200. Stage 2 (2026-10-14): build exit 0, `/health` and `/` 200. Stage 3 (2026-10-16): build exit 0, `/health` 200 on first try, full smoke transcript (reset, explain, policy publish, create, history, decision, series) PASS. Stage 4: prior build/health/UI smoke PASS. |
| Zero-intervention scored run | NOT YET ESTABLISHED | Stage 3 runs in a new clean room under a single owner dispatch with no intermediate steering. It is not claimed as a scored run until the full-room export is downloaded and preserved. |
| Video with BAND room and walkthrough | MISSING | Must be recorded and linked |
| Slides | MISSING | Must be created and linked |

## Why public visibility did not permit the earlier push

GitHub visibility controls read access. It does not grant write access. The
authenticated account `123114-robot` could clone the teammate repository but
received HTTP 403 when pushing because it was not a collaborator. This repository
is owned by `123114-robot`, so its evidence branch can be pushed without
bypassing permissions.

## Required path to a genuinely compliant submission

1. Treat the current official participant guide and track specs as authoritative.
2. Decide whether to rebuild the official contract in a new clean BAND run or publish this branch only as an engineering archive.
3. For a scored rebuild, use one task dispatch per stage and no later steering; retain a fresh full-room export.
4. ~~Replace the Stage 3 transitional pinned predecessor packaging with a self-contained cumulative official-contract service.~~ **DONE 2026-10-16** — Stage 3 is now stage-2 carried forward and self-contained; see `STAGE3_BAND_EXECUTION_REPORT.md` and `STAGE3_OFFICIAL_VALIDATION.md`.
5. Keep `python -m harness check ... --track tablekeeper` passing after every structural change. Maintained (run with `PYTHONUTF8=1`).
6. Run `python -m harness run --track tablekeeper --repo ... --all --mode isolated` and preserve the exact output. **BLOCKED on this Windows host** (see row above); exact output preserved in `STAGE3_OFFICIAL_VALIDATION.md` Block 6.
7. Record the BAND room and product walkthrough; add slides and final form receipt.
8. Download the full new-room export and preserve it as a new file (owner console action); never overwrite the frozen `room.json`.

Until these steps pass, use the wording "project tests passed" rather than
"official Dark Factory submission passed."
