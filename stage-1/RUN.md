# Stage 1 run instructions

Stage 1 implements the official Tablekeeper Stage 1 HTTP contract: authentication,
public restaurant and availability reads, reservation create/list/get/cancel/patch,
idempotency, atomic move batches, and the `/_test/*` reset/export/import hooks.

```sh
docker build -t tablekeeper-stage-1 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-1
curl http://127.0.0.1:8080/health
```

`PORT` defaults to `8080`. The service binds to `0.0.0.0` in the container and
requires no outbound network at runtime. All state is in memory: a fresh process
starts empty and `POST /_test/reset` replaces it with a provided fixture, so there
is no database file or volume to mount.

## Local development

```sh
node src/server.ts      # start the service (Node >= 22.6 runs TypeScript directly)
node --test             # run the stage-1 acceptance tests
npm run typecheck       # type-check without emitting
```
