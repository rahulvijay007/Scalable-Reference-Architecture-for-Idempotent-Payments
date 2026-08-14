# Benchmark Results

Raw output from `packages/backend/scripts/run-all-benchmarks.ts --light`, run
against a local dockerized Postgres + Redis, `MOCK_GATEWAY_SUCCESS_RATE=1`
for deterministic gateway behavior. One JSON file per (script, strategy,
concurrency) combination; `verify-idempotency.ts`'s ground-truth database
check is embedded under the `verification` key in each
`idempotency-race-*.json` file.

## Headline result (idempotency-race, concurrency=10, both modes)

| Strategy | Payment rows created (safety) | Requests with a definitive response (liveness) |
|---|:---:|:---:|
| `naive` | 1 (safe) | 1 / 10 |
| `optimistic` | 1 (safe) | 10 / 10 |
| `redis-lock` | 1 (safe) | 10 / 10 |

This matches `research/formal-model/idempotency-protocol.md` exactly: the
database's `UNIQUE` constraint on `idempotencyKey` guarantees safety
regardless of strategy, but only `optimistic` and `redis-lock` guarantee
every concurrent caller gets a well-defined outcome instead of an unhandled
error. Same result holds for both the `identical`-payload and
`conflict`-payload race modes.

## Files

- `throughput-latency-<strategy>-<vus>vus.json` — authorize→capture→refund latency/throughput at increasing concurrency.
- `idempotency-race-<strategy>-<mode>-<concurrency>.json` — k6 check pass/fail rates + embedded DB verification.
- `rbac-overhead-<vus>vus.json` — auth/RBAC middleware cost isolation (strategy-independent, run once).
- `observability/` — Prometheus query output from the fault-injection procedure (see Phase 5).

## Reproducing

See `research/REPRODUCE.md`. Short version:
```
docker compose up -d postgres redis
cd packages/backend && pnpm prisma:migrate && pnpm prisma:seed
pnpm bench:run-all -- --light          # this data (fast)
pnpm bench:run-all                     # full concurrency/duration matrix (slower)
```

## Note on this run

This `--light` run uses concurrency levels [1, 10] and 8s durations rather
than the full [1, 10, 25, 50] / 15s matrix `run-all-benchmarks.ts` supports
by default, to keep a full run practical. The qualitative safety/liveness
result above does not depend on concurrency level - it was also confirmed
at concurrency=20 in an earlier exploratory run
(`idempotency-race-optimistic-identical-20.json`). A full high-concurrency
sweep is straightforward future work: `pnpm bench:run-all` (no `--light`).
