# Commands and Validation Record

Executed on Windows 11 / PowerShell on 2026-10-09 unless noted.

## Source identity

```powershell
git status --short --branch
git show -s --format=%H%n%T%n%P HEAD
git diff --check 4a4e00b..HEAD
```

Observed source state:

- Branch `feature/stage-4-ui`, clean and two commits ahead of its original remote baseline.
- HEAD `c7a3cc3069583f7af46b6ebafa91ba3cdcb82937`.
- Tree `6c912d5027693fd15a36c6417e6bc1c1e0eacbfb`.
- Parent `d6960137b5253c0a1d8090bec72848ceec314d5a`.
- Diff whitespace check passed.

## Project tests

```powershell
cd stage-1; npm test
cd stage-2; npm test
cd stage-3; npm test
cd stage-4; npm test
cd stage-4; npm run typecheck
cd stage-4; npm run test:e2e
```

Observed results:

| Command | Result |
| --- | --- |
| Stage 1 `npm test` | 57 passed, 0 failed |
| Stage 2 `npm test` | 28 passed, 0 failed |
| Stage 3 `npm test` | 54 passed, 0 failed |
| Stage 4 `npm test` | 81 passed, 0 failed |
| Stage 4 `npm run typecheck` | exit 0 |
| Stage 4 `npm run test:e2e` | 5 passed, 0 failed |

The Playwright scenarios cover Quick Demo through booking and cancellation, an already-taken slot, invalid duration, unreachable backend, and a narrow mobile viewport.

## Docker verification

```powershell
cd stage-4
npm run docker:build
docker run -d --name tablekeeper-stage4-verify -p 18080:8080 -e DATABASE_PATH=:memory: tablekeeper-stage4
Invoke-RestMethod http://127.0.0.1:18080/health
Invoke-WebRequest http://127.0.0.1:18080/
docker rm -f tablekeeper-stage4-verify
```

Observed: image build exit 0; health returned `{"status":"ok"}`; home page returned HTTP 200 and contained `TableKeeper`.

## Scope and secret checks

```powershell
git diff --quiet 4a4e00b -- stage-1 stage-2 stage-3
git grep -n -I -E '(ghp_|github_pat_|sk-|rc_|AKIA|BEGIN .*PRIVATE KEY)' HEAD -- stage-4
```

Observed: frozen scope passed; no tracked Stage 4 match for the selected credential patterns.

## Official submission preflight

```powershell
$env:PYTHONUTF8='1'
python -m harness check <submission-repo> --track tablekeeper
```

Observed: `room.json` and mandate checks were readable, but preflight failed because Stages 1–3 lack required `Dockerfile` and `RUN.md` files. The current official stage specifications also describe a different API/stage contract. No official harness PASS is claimed.

## 2026-10-14 compliance-repair P0

Official source revision:
`803560d2a678ace1414465c098eb0ab5380ffade`.

```powershell
$env:PYTHONUTF8='1'
python -m harness check ..\submission-review --track tablekeeper
```

Observed: exit `0` with `ok — gates 1, 2 and the mandate part of gate 4 pass`.
This is a structural/provenance preflight only; it does not build the containers
or score the Tablekeeper contract.

Docker verification was attempted with:

```powershell
docker version --format '{{.Server.Version}}'
```

Result: `BLOCKED`. Docker Desktop's Linux engine pipe was not present, so no
Stage 1–3 image build, startup smoke, or official isolated run is claimed.

Project regression results during this change:

- Stage 1 full suite first run: `56/57`, one concurrency fixture timing failure
  (`race-innocent` fired before the go signal). Typecheck: PASS.
- Stage 1 targeted concurrency rerun: `4/4 PASS`.
- Stage 2 project suite: `28/28 PASS`; new server entry point syntax check: PASS.
- Stage 3 project suite: `54/54 PASS`; new server entry point syntax check: PASS.
- Stage 1–3 local HTTP startup smoke: PASS; each entry point bound to
  `0.0.0.0` on a distinct port and returned `{"status":"ok"}` from `/health`.

The first Stage 1 result is retained rather than being replaced by the passing
rerun. The local smoke is not a container test. These remain project tests, not
official harness results.

## 2026-10-14 Stage 1 official-contract repair

Branch `fix/official-tablekeeper-compliance`, parent HEAD
`c71f4b131ddc62a50997b8e4d0a5a07e4e114913`. All changes confined to `stage-1/**`.
Canonical harness/spec root this round: `official-harness-review` at
`803560d2a678ace1414465c098eb0ab5380ffade` (working tree clean; left untouched).

G1 — project suite (workdir `stage-1`):

```powershell
node --test
npm run typecheck
```

Observed: `node --test` -> 42 passed, 0 failed; `npm run typecheck` -> exit 0, clean.

G2 — structural preflight (workdir `official-harness-review`):

```powershell
$env:PYTHONUTF8='1'; python -m harness check "C:\Users\deba3\band-work\submission-review" --track tablekeeper
```

Observed: exit `0`, `ok — gates 1, 2 and the mandate part of gate 4 pass`.

G3 — official harness run, host mode (outbound NOT blocked), shipped partial
suite — 120 passed. This is NOT an isolated PASS and NOT a full grading result;
the shipped suite is a portion of the judge's full set.

```powershell
$env:PYTHONUTF8='1'; python -m harness run --track tablekeeper --repo "C:\Users\deba3\band-work\submission-review" --stage 1 --mode host --out "runs/stage1-host-03"
```

Observed: `stage 1: pass`; `stage 2: error`; `highest contiguous stage: 1`;
`claimed stage: 1 on the shipped checks`; exit `0`. Log
`runs/stage1-host-03/stage-1.log` -> `120 passed in 253.21s`; counts
`{"collected":120,"passed":120,"failed":0,"errors":0}`
(stage_1/{health_reset_auth 12, reservations 37, restaurants_availability 18,
retries_time_input 20, sample 20, seeded_state 13}). The `stage 2` line is the
overshoot probe: it errored in the `browser` fixture because Playwright Chromium
is not installed on this host, so it held no stage-2 answer (`overshoot null`).

G4 — Docker build and `/health` (workdir repo root):

```powershell
docker build -t tablekeeper-stage-1 "C:\Users\deba3\band-work\submission-review\stage-1"
docker run -d --rm -e PORT=8080 -p 18080:8080 --name tk-g4 tablekeeper-stage-1
Invoke-WebRequest http://127.0.0.1:18080/health
docker rm -f tk-g4
```

Observed: build exit 0; `GET /health` -> HTTP 200 `{"status":"ok"}` in ~1s.

G3 isolated — BLOCKED / UNVERIFIED on this Windows host (harness left pristine):

```powershell
$env:PYTHONUTF8='1'; python -m harness run --track tablekeeper --repo "C:\Users\deba3\band-work\submission-review" --stage 1 --mode isolated --out "runs/stage1-iso-01"
```

Observed: `stage 1: error`, exit `4`; log `runs/stage1-iso-01/stage-1.log` ends
`ERROR: file or directory not found: tablekeeper\test\stage_1`. Cause: harness
`harness/cli.py:89` `str(path.relative_to(ROOT))` emits `tablekeeper\test\stage_1`
with backslashes on Windows and passes it to the Linux runner container. This is
a Windows-only harness path-separator defect; it would not occur on Linux/CI. No
harness file was modified.
