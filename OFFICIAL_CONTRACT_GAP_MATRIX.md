# Official Tablekeeper contract gap matrix

Official source revision: `803560d2a678ace1414465c098eb0ab5380ffade`.

Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN` refer only to the
named verification. Project tests are not official harness results.

| Area | Existing implementation | Required repair | Current verification |
| --- | --- | --- | --- |
| Stage 1 packaging | Source was an unrelated booking core that imported an `index.js` entry point; no repository `Dockerfile` for the official layout | Replaced with a self-contained official-contract service plus `Dockerfile` and `RUN.md`; container build verified 2026-10-14 | Structural preflight: PASS; local `/health`: PASS; Docker G4: PASS |
| Stage 1 API | Custom `/v1/restaurants` and `/v1/bookings` routes | Implement the complete official auth, restaurant, availability, reservation, move, and test-state contract | Official Stage 1 contract implemented; official harness host mode, shipped partial suite 120/120 PASS; isolated BLOCKED (Windows harness path-separator defect `harness/cli.py:89`) |
| Stage 2 packaging | Incremental modules imported Stage 1 from a sibling folder | Replaced with a self-contained official-contract service plus `Dockerfile`, `RUN.md` and `tsconfig.json`; container build verified 2026-10-14 | Structural preflight: PASS; local `/health`: PASS; Docker G4 (`/health` and `/`): PASS |
| Stage 2 product | Availability module and later custom Stage 4 UI | Implement official browser routes, `data-testid` contract, stale/lost-response recovery, and table combinations | Official Stage 2 contract implemented; official harness host mode, shipped partial suite Stage 1 120/120 + Stage 2 25/25 (sample 8, UI 17) PASS; isolated BLOCKED (Windows harness path-separator defect `harness/cli.py:89`) |
| Stage 3 packaging | Incremental hardening modules, no integrated server | Transitional cumulative server; integrate Stage 3 behavior during P1 | Docker smoke: BLOCKED because Docker Desktop is unavailable |
| Stage 3 contract | Auth, audit, migrations, restart, rate-limit utilities | Implement effective-dated policies, accepted terms, truthful history, decisions, series, authorization, and upgrade behavior | Official isolated harness: NOT RUN |
| BAND autonomy | Recovery room contains human continuation messages | Run a new room with one dispatch per stage and no intermediate steering | Existing room: NOT ELIGIBLE as zero-intervention evidence |
| Submission assets | Repository evidence exists | Add room walkthrough video, slides, and receipt if submissions are reopened | NOT RUN / MISSING |

The event page reports that the hackathon has finished. Passing the published
harness after the deadline would establish technical compatibility only unless
the organizer explicitly accepts a late or replacement submission.
