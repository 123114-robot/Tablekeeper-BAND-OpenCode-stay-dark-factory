# Stage 2 run instructions

Stage 2 implements the official Tablekeeper Stage 1 contract in full, and adds the
official Stage 2 contract: two-table combinations, `available_options`, and the
browser screens at `/`, `/signup`, `/login` and `/lookup`. The folder is
self-contained — the image copies only `package.json` and `src`, so it builds and
runs with no sibling directory and no outbound network.

```sh
docker build -t tablekeeper-stage-2 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-2
curl http://127.0.0.1:8080/health          # {"status":"ok"}
curl http://127.0.0.1:8080/                # the search screen (HTML)
```

`PORT` defaults to `8080`. The service binds to `0.0.0.0` in the container and
requires no outbound network at runtime: the UI is server-rendered and its one
script is inline, so there is no CDN and no build step. All state is in memory — a
fresh process starts empty, and `POST /_test/reset` replaces it with a provided
fixture. There is no database file or volume to mount.

## Local development

```sh
node src/server.ts      # start the service (Node >= 22.6 runs TypeScript directly)
node --test             # run the carried-forward stage-1 suite and the stage-2 suite
npm run typecheck       # type-check without emitting
```
