# Stage 3 run instructions

This transitional package starts the existing cumulative Stage 1 plus Stage 2
HTTP service while packaging the existing Stage 3 engineering modules. Its
sibling dependencies are pinned to merge commit
`99ca88641a0db6b38432016dc896d70e24ea9c3a` at build time. Runtime is offline.
P1 must integrate Stage 3 policies, history, decisions, and recurrence into the
official cumulative HTTP contract.

```sh
docker build -t tablekeeper-stage-3 .
docker run --rm -p 8080:8080 -e PORT=8080 tablekeeper-stage-3
curl http://127.0.0.1:8080/health
```

`PORT` defaults to `8080`. `TABLEKEEPER_DB` defaults to
`/data/tablekeeper.db`; mount `/data` if persistence is required. The service
binds to `0.0.0.0` and needs no outbound network at runtime.

The official Stage 3 policy, history, decision, and series endpoints are not
implemented. Official Stage 3 verification is therefore not claimed.
