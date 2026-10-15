# Stage 3 - Availability explanations, policies, history, recurring agreements

**Status:** implementing the official Stage 3 contract. The authoritative contract is
`tablekeeper/spec/stage-3.md` in the harness package. The folder is self-contained: it
does not import from `stage-1/` or `stage-2/`.

## What this stage is for

Stage 3 keeps the whole official Stage 1 and Stage 2 surface - authentication, public
restaurant and availability reads, reservation create/list/get/cancel/patch, idempotency,
atomic move batches, two-table combinations with `available_options`, the four browser
screens, and the `/_test/*` hooks - and adds four things on top:

- **Why a slot was or was not available.** `GET /availability?...&explain=true` adds an
  `explain` array to every slot: one entry per table in fixture order, each naming its
  `capacity` and `no_overlap` rules as `{rule, holds}` booleans, an `available` verdict,
  and the `policy_version` used. Anything but the literal `true` is `422`.
- **Policies and accepted terms.** A manager publishes dated policies (`slot_minutes`,
  `reservation_duration_minutes`, `cancellation_cutoff_minutes`, `opening_hours`,
  `capacities`). The greatest `effective_from` on or before the booking date wins; ties
  go to the newest. Every booking snapshots the in-force policy into `accepted_terms`, so
  later publications never retroactively change what a diner agreed to.
- **Revision and history.** Every reservation carries a `revision` and an append-only
  `history` of `created`, `changed` and `cancelled` entries. `PATCH` accepts
  `expected_revision` (`409 stale_revision` on mismatch) and only records a `changed`
  entry for a real amendment - same canonical table set, same time and party is a no-op.
  `GET .../history` and `GET .../decision` are owner-only reads.
- **Recurring agreements.** `POST /series` adopts an anchor booking into a recurring
  series, generating `count - 1` further occurrences at `interval_weeks` spacing under
  each date's own policy. Adoption plans every occurrence before committing, so a single
  invalid date (a DST gap, a closed day, an occupied table) rejects the whole request and
  leaves no partial series. `GET /series/{id}` reads it; a real occurrence amendment marks
  a permanent diner exception and bumps the series revision.

## Why the shape is what it is

- **Self-contained, zero runtime dependencies.** The image copies `package.json` and
  `src` only. `node:http`, `node:crypto` and the platform `Intl` time-zone data are
  enough, so the container needs no network at runtime and no build step.
- **Policies apply by date, not by wall-clock now.** A booking resolves the policy that
  governs its *restaurant-local date*, which is what a diner experiences; a failed
  publication allocates no version, so version numbers only advance on committed writes.
- **Accepted terms are a snapshot, not a live lookup.** Cancellation cutoffs are read from
  `accepted_terms.cancellation_cutoff_minutes`, so publishing a stricter policy tomorrow
  cannot strand a booking made today.
- **The guarantee lives in the store.** Every mutating path validates, checks overlaps per
  member table, and commits in one synchronous step on Node's single JavaScript thread.
  Adoption and move batches plan first and commit once, so a racing client still produces
  exactly one `201` and a rejected batch changes nothing.
- **Time is absolute underneath.** Local wall-clock strings resolve to an instant in the
  restaurant's zone; overlap compares instants, so a DST transition cannot create or hide a
  double booking. A spring-forward gap is `422 invalid_local_time`.

## Upgrade path

A stage-1 or stage-2 `POST /_test/import` payload upgrades in place: reservations gain
`revision: 1`, policy-0 `accepted_terms`, and a synthesized `created` entry, so history and
decision work immediately and the anchor can be adopted into a series. A stage-3 export
round-trips `manager_user_ids`, `policies`, `revision`, per-reservation `accepted_terms` /
`history` / `series_id`, and the `series` list exactly.
