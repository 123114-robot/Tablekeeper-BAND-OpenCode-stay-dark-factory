# Stage 2 run instructions

This transitional package starts the existing cumulative Stage 1 plus Stage 2
engineering service. The current source imports Stage 1 modules from a sibling
directory, so the image pins those modules to merge commit
`99ca88641a0db6b38432016dc896d70e24ea9c3a` at build time. Runtime does not use
the network. P1 must replace this transitional layout with a self-contained
official-contract implementation.

```sh
docker build -t tablekeeper-stage-2 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-2
curl http://127.0.0.1:8080/health
```

`PORT` defaults to `8080`. `TABLEKEEPER_DB` defaults to
`/data/tablekeeper.db`; mount `/data` if persistence is required. The service
binds to `0.0.0.0` and needs no outbound network at runtime.

The current package does not implement the official Stage 2 browser routes,
test hooks, authentication, or combined-table contract. Official Stage 2
verification is therefore not claimed.
