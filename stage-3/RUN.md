# Stage 3 run instructions

Stage 3 implements the official Tablekeeper Stage 1 and Stage 2 contracts in full,
and adds the official Stage 3 contract: `explain=true` availability, policy
publication and selection with accepted terms, reservation revision and
`expected_revision`, reservation history and decision endpoints, recurring
agreements (`POST /series`), moves under policies, and a stage-3 export/import
that round-trips all of it. The folder is self-contained: the image copies only
`package.json` and `src`, so it builds and runs with no sibling directory and no
outbound network.

```sh
docker build -t tablekeeper-stage-3 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-3
curl http://127.0.0.1:8080/health          # {"status":"ok"}
curl http://127.0.0.1:8080/                # the search screen (HTML)
```

`PORT` defaults to `8080`. The service binds to `0.0.0.0` in the container and
requires no outbound network at runtime: the UI is server-rendered and its one
script is inline, so there is no CDN and no build step. All state is in memory: a
fresh process starts empty, and `POST /_test/reset` replaces it with a provided
fixture. There is no database file or volume to mount.

## Local development

```sh
node src/server.ts      # start the service (Node >= 22.6 runs TypeScript directly)
node --test             # all three suites: stage-1/2 carried forward plus stage-3
npm run typecheck       # type-check without emitting
```

The test command runs `test/api.test.ts` (stage 1), `test/stage2.test.ts`
(stage 2) and `test/stage3.test.ts` (stage 3) in one `node --test` pass.

## Stage 3 surface added on top of stage 2

- `GET /availability?...&explain=true` adds a `explain` array per slot: one entry
  per table in fixture order with `rules` (`capacity`, `no_overlap`), an
  `available` verdict and the `policy_version` it was judged under. Any value
  other than the literal `true` is `422 validation_failed`.
- `GET|POST /restaurants/{id}/policies` lists and publishes policies. A publish
  is `201` with a fresh ascending `policy_version`; only a restaurant manager may
  publish, and the ordinary detail response is unchanged.
- Reservations carry `revision` and a `accepted_terms` snapshot taken from the
  policy in force on the booking date.
- `PATCH /reservations/{reference}` accepts `expected_revision` (`409
  stale_revision` when a positive integer differs, `422` when invalid) and, when
  it is a real amendment, revalidates against the policy of the resulting date.
- `GET /reservations/{reference}/history` and `/decision` answer for the owner
  only (anyone else gets `404`, never `401`).
- `POST /series` adopts a recurring agreement from an anchor booking; `GET
  /series/{id}` reads it. A failed adoption leaves no trace.
