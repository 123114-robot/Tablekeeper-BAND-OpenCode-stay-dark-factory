# Stage 3 BAND Execution Report

This report records how the Stage 3 official-contract repair was produced by
BAND coding seats, so the change is auditable without replaying the room.

## Run identity

| Item | Value |
| --- | --- |
| BAND room | `c66e0b22-5664-4e23-b8dc-46937636bb3a` |
| Branch | `fix/stage3-band-official-compliance` |
| Base HEAD | `a257d9a4f988b3c7bca7b4d1fb055e9781171191` |
| Stage 1 ancestor | `320a7f1067901b96bc6da05630f3460de7839b70` |
| Stage 2 ancestor | `4cc4eed72b544a80c71504cc9aadb3cb56f1f40a` |
| Official harness/spec revision | `803560d2a678ace1414465c098eb0ab5380ffade` |
| Runtime | OpenCode + Band local adapters |
| Model | `opencode/big-pickle` (all seats) |
| Repository | `https://github.com/123114-robot/stay-dark-factory-submission.git` |

Seats and sessions:

| Seat | Session id |
| --- | --- |
| Planner | `ses_ebfe00273ffepIjgU587Mf6yyM` |
| Implementer | `ses_ebfdff61bffezciCQ5GGgiIj23` |
| Reviewer | `ses_ebfdff7daffeKnHsLSa5KnAeyr` |

Runtime/model evidence (from `C:\Users\deba3\.local\share\opencode\log\opencode.log`,
current run `95cc4c71`, 2026-10-15): all three seats report `providerID=opencode`,
`modelID=big-pickle`. Verbatim: **this host's runtime was `opencode/big-pickle`,
not Kimi.** The mandate's Kimi (`providerID=featherless`, `modelID=moonshotai/
Kimi-K2.5`) appears only in older 2026-10-04 log entries, not in this round. This
is the formal evidence gap; the mandates are left frozen as delivered.

## Scope and frozen boundary

- Changed: `stage-3/**` and top-level compliance docs
  (`SUBMISSION_COMPLIANCE.md`, `EVIDENCE_CHECKLIST.md`,
  `COMMANDS_AND_VALIDATION.md`, `OFFICIAL_CONTRACT_GAP_MATRIX.md`, plus this
  report and `STAGE3_DELIVERY_CHECKLIST.md`).
- Frozen and byte-identical: `stage-1/**`, `stage-2/**`, `stage-4/**`,
  `mandates/**`, `room.json`.
- `room.json` is the frozen prior-room export and is never replaced. The new
  room's full export is a pending owner Band-console action to be saved as a new
  file.

## Workflow executed in-room

1. **Preflight / freeze check (Planner).** Confirmed the workspace junction,
   branch, base HEAD, ancestor commits, and the pinned official checkout; verified
   the frozen paths carry no diff.
2. **Gap matrix and plan (Planner).** Produced the Stage 3 gap matrix
   (`G0`–`G12`) and a file-boundary plan against the official `stage-3.md`, and
   posted it to the room.
3. **Handoff with the full spec (Planner → Implementer).** Pasted the complete
   official Stage 3 contract verbatim and fixed the accepted interpretation
   decisions D1–D9.
4. **Implementation (Implementer).** Rebuilt `stage-3` as stage-2 carried
   forward — `src/policies.ts`, `src/history.ts`, `src/series.ts` plus the
   carried store/domain/routes/errors — and removed the pre-official placeholder
   modules.
5. **Reconciliation (Implementer ↔ Planner).** Applied D1 (check order in
   `domain.ts` `patchReservation` and the per-move loop) and D7
   (`getRestaurant` now carries `manager_user_ids`); confirmed D2/D3/D4/D5/D6/D8/
   D9 already conforming. Pinned the two reconciled behaviors with tests.
6. **Evidence (Implementer).** Captured `STAGE3_OFFICIAL_VALIDATION.md` with the
   project suite, typecheck, Docker smoke, `harness check`, host-mode run and the
   isolated BLOCKED transcript.
7. **Doc round (Planner).** Updated the four stale compliance docs and created
   this report and the delivery checklist.
8. **Review (Reviewer).** Pending — the pre-commit gate runs after this round.

## Binding interpretation decisions (D1–D9)

- **D1** Check order for `PATCH`/move: `404 owner → 422 bad expected_revision
  type/range → 409 reservation_cancelled → 409 stale_revision → 409
  cutoff_passed → field validation → occupancy`.
- **D2** History `at` timestamps use the restaurant offset.
- **D3** Policy RBAC order: `401 → 404 → 403`; a missing `Idempotency-Key` (400)
  precedes the unknown-restaurant 404 (stage-1 §7).
- **D4** Imported/seeded reservations get one synthesized `created` entry only;
  no synthesized `cancelled`.
- **D5** Repeated `explain` uses the first occurrence; only the literal `"true"`
  selects the explaining shape, otherwise 422.
- **D6** Restaurant revision is internal: adoption `+1`, moves batch `+1`, policy
  publish does not increment.
- **D7** Restaurant detail includes `manager_user_ids`.
- **D8** Pair ↔ single amendments use `table_ids`.
- **D9** Seeded reservation duration follows the fixture (policy 0).

## Disclosed decisions

- **Placeholder-module removal.** The pre-official `stage-3` placeholder modules
  (`audit`, `auth` hardening leftovers, `logs`, `migrations`, `rate-limit`,
  `restart`, `timezone-suite`) and their tests were removed because they were not
  part of the official Stage 3 contract and one (`server.ts`) imported
  nonexistent sibling paths from `stage-1`/`stage-2`. This is a Planner-scoped
  decision recorded here and in `STAGE3_OFFICIAL_VALIDATION.md`.
- **Model/mandate mismatch.** The frozen mandates name a Kimi (Featherless)
  model; the actual runtime is `opencode/big-pickle`. Discarded Featherless
  attempts returned HTTP 401 and wrote no product state. Mandates are left
  frozen; this is recorded as a formal evidence gap.

## Verification summary

| Check | Result |
| --- | --- |
| Stage 3 project suite | 92/92 PASS |
| Stage 3 typecheck | clean |
| Stage 1 regression | 42/42 PASS |
| Stage 2 regression | 60/60 PASS |
| Stage 3 Docker build + smoke | PASS |
| `harness check` (UTF-8 mode) | exit 0 |
| Host-mode harness (directional) | 120/120, 25/25, 7/7; Stage 4 overshoot fail; claimed stage 3 |
| Isolated `--all` harness | BLOCKED / UNVERIFIED |
| Reviewer verdict | pending |

## Evidence gaps (not fabricated)

- Isolated official harness BLOCKED on this Windows host; two preserved causes.
- Host-mode results are directional, not a grading pass.
- Mandate/model mismatch as above.
- No commit or push exists yet; it happens only after Reviewer PASS and this
  report is then updated with the pushed commit SHA at that gate.

## Room-review follow-ups (2026-10-16)

- **Validation-doc touch (reviewer flag 1).** `STAGE3_OFFICIAL_VALIDATION.md`
  was last written at 04:35:55 by the **Implementer**, inside the round-2 window:
  the edit added the D1–D9 conformance map (strictly additive, accurate, no
  contradiction with the 04:27 content). It is frozen at SHA-256
  `ee952125a8c346979f64ebe75ece4972a23afb1a6922429f2961bc110f040a2f`.
- **Seat↔session mapping (reviewer flag 2).** Confirmed **correct as recorded**
  from `opencode.log` `created` entries whose `title` is
  `Band: <Role> / c66e0b22-5664-4e23-b8dc-46937636bb3a`: Planner =
  `ses_ebfe00273ffepIjgU587Mf6yyM`, Implementer =
  `ses_ebfdff61bffezciCQ5GGgiIj23`, Reviewer =
  `ses_ebfdff7daffeKnHsLSa5KnAeyr`. The report table is unchanged; the reviewer's
  local env reading of `…61…` as its own session is the mismatch, not the table.
- **Stale non-owned docs (reviewer flag 3).** `README.md` and
  `STAGE_SUMMARY.md` were refreshed to match the tree: the current official
  Stage 1–3 contract, Stage 3 92/92 + host-mode 7/7 (directional), isolated
  BLOCKED, and removal of the placeholder-module description and the old
  `54/54` / "Stages 3–4 `/v1/`" claims. These were outside the six-doc ruling and
  are recorded here as corrected.

## Git gate

No commit is made until the Reviewer returns PASS on this round. After PASS: a
focused commit on `fix/stage3-band-official-compliance`, a push of the public
branch, remote-SHA verification, and the SHA recorded here. No merge to `main`;
the pull request is opened by Codex.
