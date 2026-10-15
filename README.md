# Stay Tablekeeper Factory — Stage 1–4 Evidence Branch

This branch preserves the Tablekeeper implementation produced through a three-seat BAND room, together with the complete room export, seat mandates, stage source, tests, delivery files, and an evidence-bounded compliance report.

## Read this first

The repository is public and auditable. This branch does **not** claim a full official Dark Factory Tablekeeper harness result. Local project tests pass and the official structural preflight passes. Stages 1–3 now implement the current official contract: an official harness run in host mode (shipped partial suite, a portion of the judge's set) reports Stage 1 120/120, Stage 2 25/25 and Stage 3 7/7 PASS (`claimed stage: 3`), while isolated mode is BLOCKED on this Windows host by a harness path-separator defect (`harness/cli.py:89`) plus an empty Stage 4 combined-build context. Stage 4 remains an earlier iteration and does not implement the current official Stage 4 specification. See [SUBMISSION_COMPLIANCE.md](SUBMISSION_COMPLIANCE.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `mandates/` | Generic mandates for the actual Planner, Implementer, and Reviewer seats |
| `room.json` | Unmodified full-room download from BAND |
| `stage-1/` | Official-contract reservations service (auth, restaurants, availability, reservations, moves) with an in-memory store; `node --test` suite |
| `stage-2/` | Official-contract service extending Stage 1 with declared table combinations, `available_options`, and four server-rendered browser screens; in-memory store, `node --test` suite |
| `stage-3/` | Official Stage 3 contract: availability explanations, reservation history, policy publication and versioning, decisions, recurring series, combined-table history, moves under policies, and Stage 1/2 import compatibility; in-memory store, `node --test` suite |
| `stage-4/` | Responsive browser UI, same-origin proxy, deployment supervisor, Dockerfile, RUN.md, and Playwright E2E |
| `STAGE_SUMMARY.md` | What each stage actually contains |
| `BAND_RUN_REPORT.md` | How BAND was configured, operated, recovered, and reviewed |
| `COMMANDS_AND_VALIDATION.md` | Commands executed and their observed results |
| `SUBMISSION_COMPLIANCE.md` | Official-rule mapping, passes, gaps, and required follow-up |
| `EVIDENCE_CHECKLIST.md` | Claim-by-claim evidence state |

## Verified local results

- Stage 1: 42/42 project tests passed (official-contract suite, 2026-10-14); official harness host mode, shipped partial suite: 120/120 PASS.
- Stage 2: 60/60 project tests passed (official-contract suite, 2026-10-14); official harness host mode, shipped partial suite: 25/25 PASS.
- Stage 3: 92/92 project tests passed (official-contract suite, 2026-10-16) with a clean `tsc --noEmit`; official harness host mode, shipped partial suite: 7/7 PASS.
- Stage 4: 81/81 tests, syntax/type checks, and 5/5 Playwright scenarios passed.
- Stage 4 Docker image built successfully; `/health` returned `{"status":"ok"}` and `/` returned HTTP 200.
- Frozen Stage 1–3 scope check, tracked-secret scan, and `git diff --check` passed in the source worktree.
- BAND Reviewer returned PASS for the Stage 4 task at source commit `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.

These results establish the behavior of this implementation against its own project contract. They do not substitute for the official event harness.

## Run Stage 4 locally

Requirements: Node.js 24+ and npm.

```bash
cd stage-4
npm install
npm start
```

Open `http://127.0.0.1:8080/`. Full operational instructions are in `stage-4/RUN.md`.

## Evidence integrity

The application files were transferred from the team working repository
`natchaphat5106-collab/dark-factory-tablekeeper`, source branch
`feature/stage-4-ui`, at commit `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.
The transfer preserves file contents but does not pretend that this packaging commit was authored by the BAND seats.

## Official references

- Participant guide: https://github.com/band-ai/dark-factory-wearedevs/blob/main/docs/participant-guide.md
- Event page: https://lablab.ai/ai-hackathons/wearedevelopers-hackathon
