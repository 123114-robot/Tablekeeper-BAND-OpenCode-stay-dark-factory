# Dark Factory Submission Compliance Report

Authoritative references:

- `band-ai/dark-factory-wearedevs/docs/participant-guide.md`
- Current official `tablekeeper/spec/stage-1.md` through `stage-4.md`
- Lablab event submission requirements

Official specification revision used for the compliance repair:
`803560d2a678ace1414465c098eb0ab5380ffade`.

## Requirement mapping

| Requirement | State | Evidence / gap |
| --- | --- | --- |
| Public GitHub repository | PASS | `123114-robot/stay-dark-factory-submission` |
| At least three BAND coding seats | PASS | Planner, Implementer, Reviewer in `room.json` |
| Generic mandate per actual seat | PASS | `mandates/planner.md`, `implementer.md`, `reviewer.md` |
| Harness/model named in mandates | PASS | Headers name OpenCode adapter and Kimi K2.5 |
| Full room export | PASS | Root `room.json` |
| Reciprocal seat handoffs | PASS | Visible in the full transcript and accepted by the official structural preflight at revision `803560d2a678ace1414465c098eb0ab5380ffade` |
| One complete folder per claimed stage | PARTIAL | Stage 1–3 now contain Dockerfile/RUN.md, but Stage 2–3 use explicitly transitional pinned predecessor packaging pending the cumulative official-contract repair |
| Structural official preflight | PASS | `PYTHONUTF8=1 python -m harness check ... --track tablekeeper`; this checks layout/provenance only and does not build or score the services |
| Clean isolated official harness | NOT RUN | Docker Desktop was unavailable during the P0 repair; no stage score is claimed |
| Current official API contract | FAIL | Project `/v1/...` contract and stage allocation differ from current official specs |
| Clean-container service start | PASS FOR STAGE 4 ONLY | Docker build, health, and UI smoke passed |
| Zero-intervention scored run | NOT ESTABLISHED | Recovery room includes human continuation prompts |
| Video with BAND room and walkthrough | MISSING | Must be recorded and linked |
| Slides | MISSING | Must be created and linked |

## Why public visibility did not permit the earlier push

GitHub visibility controls read access. It does not grant write access. The authenticated account `123114-robot` could clone the teammate repository but received HTTP 403 when pushing because it was not a collaborator. This repository is owned by `123114-robot`, so its evidence branch can be pushed without bypassing permissions.

## Required path to a genuinely compliant submission

1. Treat the current official participant guide and track specs as authoritative.
2. Decide whether to rebuild the official contract in a new clean BAND run or publish this branch only as an engineering archive.
3. For a scored rebuild, use one task dispatch per stage and no later steering; retain a fresh full-room export.
4. Replace the Stage 2–3 transitional pinned predecessor packaging with self-contained cumulative official-contract services.
5. Keep `python -m harness check ... --track tablekeeper` passing after every structural change.
6. Run `python -m harness run --track tablekeeper --repo ... --all --mode isolated` and preserve the exact output.
7. Record the BAND room and product walkthrough; add slides and final form receipt.

Until these steps pass, use the wording “project tests passed” rather than “official Dark Factory submission passed.”
