# Final Project Status Report

Date: 2026-10-17 (Australia/Sydney)

Branch: `fix/stage3-band-official-compliance`

This report consolidates the current, independently checked state of the public
Tablekeeper evidence branch. It deliberately separates current verification,
historical evidence, official-harness status, and remaining submission work.

## Delivery state

| Area | Current result | Evidence boundary |
| --- | --- | --- |
| Stage 1 official contract | PASS | 42/42 project tests on 2026-10-17; host-mode shipped harness suite previously 120/120 |
| Stage 2 official contract | PASS | 60/60 project tests on 2026-10-17; host-mode shipped harness suite previously 25/25 |
| Stage 3 official contract | PASS | 92/92 project tests on 2026-10-17; Reviewer PASS; host-mode shipped harness suite previously 7/7 |
| Stage 4 earlier product UI | HISTORICAL PASS, CURRENTLY INCOMPATIBLE | 81/81 and 5/5 Playwright passed at source commit `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`; the current combined tree does not pass the old Stage 4 suite after the official Stage 1-3 replacement |
| Structural preflight | PASS | `harness check` previously exited 0 with `PYTHONUTF8=1` |
| Official isolated harness | BLOCKED / UNVERIFIED | Windows-to-Linux test-path separator defect; `--all` also reaches the frozen Stage 4 combined-build-context issue |
| Official submission | INCOMPLETE | New-room export, video, slides, and submission receipt remain owner-side work |

No project-test, host-mode, or structural-preflight result in this repository is
represented as an official isolated-harness PASS.

## BAND and model evidence

Stage 3 was implemented and reviewed in clean BAND room
`c66e0b22-5664-4e23-b8dc-46937636bb3a` using Planner, Implementer, and Reviewer
seats through OpenCode. The room closed with Reviewer PASS on branch tip
`8cd3d0d088ca88d9a06a1ad00536d998bd605ac2`.

The actual successful seat runtime was `opencode/big-pickle`. A fresh
Featherless `moonshotai/Kimi-K2.5` smoke request on 2026-10-17 again returned
HTTP 401 (`You must be signed in to access this resource`). The frozen mandates
name Kimi, so the model mismatch remains an explicit evidence gap; Kimi is not
claimed as the model that produced the successful Stage 3 implementation.

## Independent recheck on 2026-10-17

- Stage 1: `npm test` — 42/42 PASS.
- Stage 2: `npm test` — 60/60 PASS.
- Stage 3: `npm test` — 92/92 PASS.
- Stage 4 first run: failed because dependencies were absent (`jsdom` missing).
- Stage 4 after `npm ci`: 54 passed, 2 failed, 25 cancelled. The root current-tree
  incompatibility is the old Stage 4 helper importing removed legacy module
  `stage-1/src/db.ts`; the composed-service tests consequently time out.

The Stage 4 result is not a newly introduced Stage 3 defect: Stage 4 was frozen
during the official Stage 1-3 repairs and still targets the earlier `/v1/...`
architecture. Making Stage 4 current-official compliant is a separate Stage 4
rebuild, not a documentation-only fix.

## Git and publication

- Stage 3 branch was already pushed before this consolidation.
- Pre-report remote and local tip matched at
  `8cd3d0d088ca88d9a06a1ad00536d998bd605ac2`.
- Main remains unmerged.
- The pull request should target `main` and retain the explicit compliance
  limitations above.

## Remaining work

1. Export the complete new BAND room as a new evidence file; do not overwrite
   the frozen root `room.json`.
2. If official Stage 4 compliance is required, run a new scoped BAND Stage 4
   rebuild against the current official Stage 4 specification and cumulative
   Stage 1-3 service, then rerun the official harness.
3. Resolve or work around the isolated harness host defect and obtain a real
   isolated result before claiming official harness PASS.
4. Record the product/BAND walkthrough video, prepare slides, and preserve the
   final submission receipt.

