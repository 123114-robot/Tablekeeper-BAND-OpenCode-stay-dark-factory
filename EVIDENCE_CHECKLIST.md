# Evidence Checklist

Legend: `[x]` verified directly, `[ ]` missing or not verified, `[!]` present with a disclosed compliance risk.

## Factory eligibility

- [x] Three distinct BAND seats: Planner, Implementer, Reviewer.
- [x] Each actual seat has a same-named generic mandate with `Harness:` and `Model:` metadata.
- [x] Complete full-room export is present as `room.json`.
- [x] Official offline check reads the room successfully when Python runs in UTF-8 mode.
- [!] The room contains valid seat-to-seat handoffs, but the Stage 4 recovery included additional human continuation messages. It must not be described as a zero-intervention scored run.

## Application evidence

- [x] Stage 1 project tests: 57/57.
- [x] Stage 2 project tests: 28/28.
- [x] Stage 3 project tests: 54/54.
- [x] Stage 4 project tests: 81/81.
- [x] Stage 4 Playwright: 5/5.
- [x] Stage 4 Docker image builds and serves `/health` and `/`.
- [!] Stage 1–3 contain Dockerfile and RUN.md packaging. Stage 2–3 packaging is transitional and must become self-contained during the official-contract repair.
- [x] Official structural preflight passes with Python UTF-8 mode at official revision `803560d2a678ace1414465c098eb0ab5380ffade`.
- [ ] Stage 1–3 Docker build and startup smoke tests (BLOCKED: Docker Desktop engine unavailable during P0).
- [ ] Official isolated harness pass for any claimed stage.
- [!] Current application API and stage allocation differ from the current official Tablekeeper stage specifications.

## Repository integrity

- [x] Source repository, source branch, and source commit are recorded.
- [x] Full room export is retained rather than replacing it with a final response.
- [x] Tracked-secret scan passed in the source Stage 4 diff.
- [x] Frozen Stage 1–3 scope check passed for the Stage 4 change.
- [x] Public claims distinguish project-test evidence from official-harness evidence.
- [ ] Confirm team ownership/licensing before treating the copied team-worktree files as a standalone licensed release.

## Submission assets

- [x] Public GitHub repository exists.
- [x] Evidence branch contains code, mandates, room export, commands, and compliance report.
- [ ] Video showing the BAND room and product walkthrough.
- [ ] Slide presentation.
- [ ] Official submission form receipt.
