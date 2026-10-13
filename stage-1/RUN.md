# Stage 1 run instructions

This package starts the existing Stage 1 engineering service. It does not yet
implement the current official Tablekeeper Stage 1 API contract; see the root
compliance report.

```sh
docker build -t tablekeeper-stage-1 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-1
curl http://127.0.0.1:8080/health
```

`PORT` defaults to `8080`. `TABLEKEEPER_DB` defaults to
`/data/tablekeeper.db`; mount `/data` if persistence is required. The service
binds to `0.0.0.0` in the container and requires no outbound network at runtime.

The current service has no official `/_test/reset`, export, or import routes.
Those checks remain blocked pending the official contract implementation.
