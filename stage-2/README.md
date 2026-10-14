# Stage 2 — Online booking and combined tables

**Status:** implementing the official Stage 2 contract. The authoritative contract is
`tablekeeper/spec/stage-2.md` in the harness package; `TASK.md` records this seat's
settled decisions. The folder is self-contained: it does not import from `stage-1/`.

## What this stage is for

Stage 2 keeps the whole official Stage 1 surface — authentication, public restaurant and
availability reads, reservation create/list/get/cancel/patch, idempotency, atomic move
batches, and the `/_test/*` hooks — and adds two things on top:

- **Combined tables.** A restaurant declares unordered pairs of tables that may be
  booked together. A booking then occupies every table in its set for its full duration,
  the set is atomic, and `available_options` offers singles and allowed pairs.
- **A browser UI.** Four screens (`/`, `/signup`, `/login`, `/lookup`) drive the same
  origin's API and handle competing clients: out-of-order searches, a table taken between
  opening the form and submitting, and a booking response lost after it committed.

## Why the shape is what it is

- **Self-contained, zero runtime dependencies.** The image copies `package.json` and
  `src` only. `node:http`, `node:crypto` and the platform `Intl` time-zone data are
  enough, so the container needs no network at runtime and no build step.
- **The guarantee lives in the store.** Every mutating path validates, checks overlaps
  per member table, and commits in one synchronous step on Node's single JavaScript
  thread. Ten racing clients still produce exactly one `201`.
- **Time is absolute underneath.** Local wall-clock strings resolve to an instant in the
  restaurant's zone; overlap compares instants, so a DST transition cannot create or hide
  a double booking. A spring-forward gap is `422 invalid_local_time`; a repeated hour
  resolves to its first occurrence and appears once.
- **The browser never invents a result.** It reads the server for availability, keeps a
  booking form's idempotency identity stable across an unchanged resubmission, and shows
  `booking-uncertain` rather than a confirmation when a response is lost.
- **Types are erased, not compiled.** Node runs the TypeScript directly.

## Running it

```sh
node --test                    # the carried-forward stage-1 suite and the stage-2 suite
node src/server.ts             # start the service on $PORT (default 8080)
npm run typecheck              # advisory typecheck, not part of the gate
```
