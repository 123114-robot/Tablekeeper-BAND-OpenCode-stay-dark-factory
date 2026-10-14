# Evidence Checklist

Legend: `[x]` verified directly, `[ ]` missing or not verified, `[!]` present with a disclosed compliance risk.

## Factory eligibility

- [x] Three distinct BAND seats: Planner, Implementer, Reviewer.
- [x] Each actual seat has a same-named generic mandate with `Harness:` and `Model:` metadata.
- [x] Complete full-room export is present as `room.json`.
- [x] Official offline check reads the room successfully when Python runs in UTF-8 mode.
- [!] The room contains valid seat-to-seat handoffs, but the Stage 4 recovery included additional human continuation messages. It must not be described as a zero-intervention scored run.

## Application evidence

- [x] Stage 1 project tests (official-contract suite): 42/42 (2026-10-14).
- [x] Stage 2 project tests: 28/28.
- [x] Stage 3 project tests: 54/54.
- [x] Stage 4 project tests: 81/81.
- [x] Stage 4 Playwright: 5/5.
- [x] Stage 4 Docker image builds and serves `/health` and `/`.
- [!] Stage 1–3 contain Dockerfile and RUN.md packaging. Stage 2–3 packaging is transitional and must become self-contained during the official-contract repair.
- [x] Official structural preflight passes with Python UTF-8 mode at official revision `803560d2a678ace1414465c098eb0ab5380ffade`.
- [!] Stage 1 Docker build and startup smoke: PASS (2026-10-14, `/health` -> `{"status":"ok"}`). Stage 2–3 Docker build/startup smoke: NOT RUN on this host.
- [!] Official isolated harness: NOT RUN / BLOCKED (Windows harness path-separator defect `harness/cli.py:89`, exit 4). Official harness host mode, shipped partial suite (a portion of the judge's set): Stage 1 120/120 PASS (2026-10-14).
- [!] Stage 1 API now conforms to the official spec; Stage 2–4 API and stage allocation still differ from the current official Tablekeeper specifications.

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

## Known limitations (Stage 1) — follow-ups, not blockers

- [x] Reviewer observation 1: a no-op `PATCH`/move re-validates the reservation's stored start, so a no-op move on an off-grid/out-of-hours *seeded* reservation returns 422 instead of retaining the record. Reachable only with seed data outside the contract (the official `test_seeded_state.py` is 13/13). Follow-up: short-circuit an empty move or validate the seed grid at reset.
- [x] Reviewer observation 2: the idempotency record key is `(user, path, key)` without `method`. No observable difference today (only `POST` carries keys, on two distinct paths) and it matches the user-scoped intent of spec §7. Follow-up: include `method` if a same-path, multi-method keyed endpoint is added.
