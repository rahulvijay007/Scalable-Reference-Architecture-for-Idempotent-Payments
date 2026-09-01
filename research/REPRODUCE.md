# Reproducing the Research Artifact

Exact steps to regenerate every number and file referenced in
`research/`, from a clean environment to final result files.

## 1. Prerequisites

- Node.js 20+, pnpm 8.14+ (`packageManager` field in root `package.json`)
- Docker + Docker Compose
- [k6](https://k6.io) load-testing tool
  - Windows: `winget install k6 --source winget`
  - macOS: `brew install k6`
  - Linux: see https://k6.io/docs/get-started/installation/
  - If `k6` isn't on `PATH` after install, set `K6_BIN` to the full executable path before running the scripts below (`packages/backend/scripts/run-all-benchmarks.ts` and `fault-injection.ts` both check `K6_BIN` first, then common Windows install paths, then fall back to `PATH`).
- Java 11+ (only for the TLA+ model check in step 4a) — verify with `java -version`.

## 2. Environment setup

```bash
cp .env.example .env
cp .env packages/backend/.env   # backend loads its own .env from its own cwd
pnpm install
```

## 3. Infrastructure

```bash
docker compose up -d postgres redis prometheus grafana
```

(`redis` is only required for the `redis-lock` idempotency strategy runs; `prometheus`/`grafana` are only required for Phase 5's observability demonstration.)

```bash
cd packages/backend
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
cd ../..
```

## 4. Verify the core claim (unit + property-based tests, no infra needed beyond the above)

```bash
pnpm --filter @payment-platform/shared test
pnpm --filter @payment-platform/backend test              # includes payment.state-machine.pbt.test.ts
pnpm --filter @payment-platform/backend test:integration   # includes security.adversarial.integration.test.ts
```

The property-based test's `Idempotency invariant under concurrency` block (in `payment.state-machine.pbt.test.ts`) is the fastest way to see the safety/liveness distinction between strategies without needing k6 or a live server - it runs the same three strategies against an in-memory fake store.

## 4a. Machine-check the formal model (TLA+, no other infra needed)

```bash
cd research/formal-model/tla
curl -sL -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar

# Naive strategy - TLC is expected to find a violation (this is the bug, restated formally)
java -jar tla2tools.jar -config IdempotentPayment_Naive.cfg IdempotentPayment.tla

# Optimistic strategy - TLC is expected to report "No error has been found"
java -jar tla2tools.jar -config IdempotentPayment_Optimistic.cfg IdempotentPayment.tla

# Optimistic strategy, exhaustively re-checked at 5 concurrent requesters (3,157 states)
java -jar tla2tools.jar -config IdempotentPayment_Optimistic_N5.cfg IdempotentPayment.tla
```

Recorded output from an actual run of all three is checked in at
`tlc-output-naive.txt`, `tlc-output-optimistic.txt`, and
`tlc-output-optimistic-n5.txt` in the same directory — the theorems in
`research/formal-model/formal-proof.md` cite these transcripts directly, so
re-running the commands above is a genuine independent verification, not a
demonstration of something already taken on faith.

## 5. Regenerate the benchmark results (`research/results/`)

```bash
cd packages/backend
pnpm bench:run-all -- --light      # fast: what's currently checked in
pnpm bench:run-all                 # full concurrency/duration matrix (slower - VUS [1,10,25,50], 15s each)
```

`--strategies=optimistic,naive,redis-lock` (any subset, comma-separated) limits which strategies run - useful for retrying just one after an interruption. Each strategy run: spawns the backend with `IDEMPOTENCY_STRATEGY=<strategy>` and `MOCK_GATEWAY_SUCCESS_RATE=1` (deterministic gateway) and `RATE_LIMIT_MAX_REQUESTS` raised (the production rate limiter is a separate concern from the protocol under test and would otherwise contaminate sustained load results), logs in once and reuses that token across every k6 invocation (the stricter 5-attempts/15-min auth rate limiter would otherwise trip partway through a single strategy's run), runs the k6 scripts, verifies idempotency-race correctness directly against Postgres, then tears the backend down before the next strategy.

Individual k6 scripts can also be run directly against an already-running backend:
```bash
cd research/benchmarks/k6
k6 run --env BASE_URL=http://localhost:3001 --env STRATEGY=optimistic --env VUS=10 --env DURATION=15s throughput-latency.js
```

## 6. Regenerate the observability demonstration (`research/results/observability/`)

Requires `prometheus`/`grafana` running (step 3) and actively scraping `host.docker.internal:3001` (already configured in `infrastructure/prometheus/prometheus.yml`).

```bash
cd packages/backend
pnpm bench:fault-injection -- --duration=90 --success-rate=0.3
```

View the resulting dashboard live at `http://localhost:3002` (admin/admin) → "Payment Platform" while a run is in progress, or inspect the raw Prometheus query output afterward in `research/results/observability/fault-injection-<timestamp>.json`.

## 7. Where everything lands

| What | Where |
|---|---|
| Formal correctness argument (prose) | `research/formal-model/idempotency-protocol.md` |
| Formal correctness argument (theorems + machine-checked TLA+ model) | `research/formal-model/formal-proof.md`, `research/formal-model/tla/` |
| Formal state machine | `research/formal-model/payment-state-machine.md` |
| Threat model | `research/security/threat-model.md` |
| Benchmark scripts | `research/benchmarks/k6/*.js` |
| Orchestration/verification scripts | `packages/backend/scripts/{run-all-benchmarks,verify-idempotency,fault-injection}.ts` |
| Raw results | `research/results/*.json`, `research/results/observability/*.json` |
| Bibliography | `research/related-work.md` |

## Known deviations from a fully mechanical script-only pipeline

- `packages/backend/scripts/` (not `research/benchmarks/`) is where the orchestration/verification TypeScript lives, so it can resolve `@prisma/client` and `.env` the same way the rest of the backend does, rather than fighting pnpm workspace module resolution from outside a package. Only the k6 `.js` scripts (which have no such dependency) live under `research/benchmarks/k6/`.
- The `--light` results currently checked into `research/results/` use concurrency levels [1, 10] rather than the full [1, 10, 25, 50] the tooling supports, to keep a full run practical to produce in one sitting. The qualitative safety/liveness result does not depend on concurrency level - see `research/results/README.md`.
