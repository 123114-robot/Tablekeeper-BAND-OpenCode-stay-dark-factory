# Stage 1 — Booking core and concurrency proof

**Status:** implementing the official Stage 1 contract. Task file: [`TASK.md`](./TASK.md).

## What this stage is for

Stage 1 retires the one assumption the whole factory rests on: **the service can
never double-book a table**, no matter how many callers write at once, how often a
request is retried, or which time zone the caller is in. It does this while
implementing the official Stage 1 HTTP surface — authentication, public
restaurant and availability reads, reservation create/list/get/cancel/patch,
idempotency, atomic move batches, and the `/_test/*` reset/export/import hooks.

## Why the shape is what it is

- **Zero runtime dependencies.** `node:test` and the platform's built-in `Intl`
  time-zone data ship with the runtime. There is no database server or message
  broker to install, so the service runs anywhere Node runs, including the
  acceptance container.
- **The guarantee lives in the store.** All critical sections are synchronous.
  Node runs one JavaScript thread, so no other request can observe or mutate the
  store between an availability check and the write it authorizes. Ten racing
  clients therefore produce exactly one `201` and nine `409`s.
- **Time is absolute underneath.** Local wall-clock strings are resolved to an
  instant in the restaurant's zone; overlaps compare instants, so DST transitions
  cannot create or hide a double booking.
- **Types are erased, not compiled.** Node runs the TypeScript directly, so the
  service is buildable and testable with no build step and no toolchain to
  install.

## Running it

```sh
node --test                    # the full gate
node src/server.ts             # start the service on $PORT (default 8080)
npm run typecheck              # advisory typecheck, not part of the gate
```
