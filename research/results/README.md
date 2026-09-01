# Benchmark Results

Raw output from `packages/backend/scripts/run-all-benchmarks.ts --light`, run
against a local dockerized Postgres + Redis, `MOCK_GATEWAY_SUCCESS_RATE=1`
for deterministic gateway behavior. One JSON file per (script, strategy,
concurrency) combination; `verify-idempotency.ts`'s ground-truth database
check is embedded under the `verification` key in each
`idempotency-race-*.json` file.

## Headline result (idempotency-race, concurrency=10, both modes)

| Strategy     | Payment rows created (safety) | Requests with a definitive response (liveness) |
| ------------ | :---------------------------: | :--------------------------------------------: |
| `naive`      |           1 (safe)            |                     1 / 10                     |
| `optimistic` |           1 (safe)            |                    10 / 10                     |
| `redis-lock` |           1 (safe)            |                    10 / 10                     |

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
- `observability/` — Prometheus query output from the gateway-failure fault-injection procedure (see Phase 5), plus `fault-injection-lock-expiry-*.json` (see below).
- `scaled/` — statistical-rigor throughput/latency sweep (5 repeated trials per concurrency tier, up to 250 VUs, mean ± stddev reported) — see `scaled/README.md`.

## Redis-lock TTL-expiry fault injection (empirical confirmation of a documented limitation)

`research/formal-model/idempotency-protocol.md` §4 documents, in prose, that
the Redis-lock strategy's liveness guarantee is _conditional_: if the
lock's critical section outlives `IDEMPOTENCY_LOCK_TTL_MS`, the lock frees
itself while still logically in use, and a second caller can race into the
same critical section. `packages/backend/scripts/fault-injection-lock-expiry.ts`
(`pnpm bench:fault-injection-lock-expiry`) turns this from an asserted-but-
unmeasured claim into a quantified, repeated-trial experiment, using a
synthetic delay (`IDEMPOTENCY_DEBUG_CRITICAL_SECTION_DELAY_MS`, off by
default everywhere else) injected inside the lock's own critical section —
necessary because the real gateway call happens _after_ the lock is
released, so the critical section the lock actually protects is normally
fast (DB-only), which is itself worth noting as a positive side effect of
the atomicity fix in §6 of that document.

**Result, 10 trials per condition, concurrency=20:**

| Condition  | Lock TTL |  In-lock delay | Safety violations | Liveness violations (trials with ≥1 unhandled response) | Total unhandled responses (out of 200) |
| ---------- | -------: | -------------: | :---------------: | :-----------------------------------------------------: | :------------------------------------: |
| Vulnerable |    150ms |        1,000ms |      0 / 10       |                       **10 / 10**                       |                 **14**                 |
| Control    |  5,000ms | 0ms (disabled) |      0 / 10       |                         0 / 10                          |                   0                    |

Raw data: `observability/fault-injection-lock-expiry-*.json`.

**Interpretation**: exactly as Theorem 1 (`research/formal-model/formal-proof.md`)
predicts, safety held in every single trial of both conditions — the
database's `UNIQUE` constraint is never bypassed regardless of the Redis
lock's state. But under the vulnerable configuration, liveness failed in
_every_ trial: 1–2 of the 20 concurrent requesters per trial received an
unhandled 500 (the same failure mode as the naive strategy — an uncaught
`P2002`), because `RedisLockStrategy.run()` never catches the unique-
constraint violation the way `OptimisticStrategy` does. This confirms the
documented limitation is real and reproducible, not just theoretically
possible, and reinforces the paper's central recommendation: the optimistic
strategy is the correct production default specifically because its
liveness guarantee has no such conditional escape hatch.

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
