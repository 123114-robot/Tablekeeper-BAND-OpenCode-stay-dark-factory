# Stage 3 Delivery Checklist

Gate to the commit/push: every required item below must be `PASS` (or an
explicitly accepted `BLOCKED` with preserved evidence) and the Reviewer must
return PASS before any commit.

Branch: `fix/stage3-band-official-compliance`. Base HEAD:
`a257d9a4f988b3c7bca7b4d1fb055e9781171191`.

## 1. Scope guard

- [x] Only `stage-3/**` and top-level compliance docs changed.
- [x] `stage-1/**`, `stage-2/**`, `stage-4/**`, `mandates/**`, `room.json`
      byte-identical.
- [x] No secret introduced (tracked-secret scan).

## 2. Project verification

- [x] Stage 3 suite 92/92.
- [x] Stage 3 typecheck clean.
- [x] Stage 1 regression 42/42.
- [x] Stage 2 regression 60/60.

## 3. Container and harness

- [x] Stage 3 Docker build exit 0.
- [x] Stage 3 `/health` 200 and product smoke PASS.
- [x] `harness check` exit 0 (run with `PYTHONUTF8=1`).
- [x] Host-mode harness captured: 120/120, 25/25, 7/7; Stage 4 overshoot fail;
      `claimed stage: 3` (directional only).
- [!] Isolated `--all` harness: BLOCKED / UNVERIFIED (empty stage-4 build
      context; Windows backslash test target). Exact output preserved, reported
      as BLOCKED, never as a pass. Accepted as an environment limitation.

## 4. Documentation

- [x] `STAGE3_OFFICIAL_VALIDATION.md` current (implementer-owned, frozen).
- [x] `OFFICIAL_CONTRACT_GAP_MATRIX.md` Stage 3 rows closed with evidence.
- [x] `SUBMISSION_COMPLIANCE.md` Stage 3 rows updated.
- [x] `EVIDENCE_CHECKLIST.md` Stage 3 entries updated.
- [x] `COMMANDS_AND_VALIDATION.md` Stage 3 command/result section appended.
- [x] `STAGE3_BAND_EXECUTION_REPORT.md` created.
- [x] `STAGE3_DELIVERY_CHECKLIST.md` created (this file).
- [x] Disclosures present: placeholder removal, mandate/model mismatch, isolated
      BLOCKER, host-mode "directional only" wording.

## 5. Reviewer gate

- [x] Reviewer doc-consistency check PASS (2026-10-16).
- [x] Reviewer overall verdict PASS — UNCONDITIONAL PASS issued.

## 6. Commit and push (only after §5 PASS)

- [ ] Focused commit on `fix/stage3-band-official-compliance`.
- [ ] Push public branch.
- [ ] Verify remote SHA equals local HEAD; record SHA in the room and in
      `STAGE3_BAND_EXECUTION_REPORT.md`.
- [ ] No merge to `main`; Codex opens the pull request.

## 7. Owner actions still outstanding

- [ ] Download the full new-room export for `c66e0b22-5664-4e23-b8dc-46937636bb3a`
      and save it as a NEW file (never overwrite frozen `room.json`).
- [ ] Record video walkthrough, slides and official submission receipt.
