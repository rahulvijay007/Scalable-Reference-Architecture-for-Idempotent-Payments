# Local Development Setup

## Prerequisites

- Node.js 20+
- pnpm 8.14+
- Docker + Docker Compose
- (optional, for benchmarks) [k6](https://k6.io)

## Steps

```bash
# 1. Environment
cp .env.example .env
cp .env packages/backend/.env   # backend reads its own .env from its own cwd

# 2. Install
pnpm install

# 3. Infrastructure (Postgres is required; the rest are optional)
docker compose up -d postgres            # minimum needed to run the app
docker compose up -d                     # everything, incl. Redis/RabbitMQ/ELK/Prometheus/Grafana

# 4. Database
cd packages/backend
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
cd ../..

# 5. Run
pnpm dev   # starts backend (:3001) + frontend (:3000) together via Turborepo
```

## Seeded Credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@payment-platform.com` | `Admin@123456` |
| Merchant | `merchant@payment-platform.com` | `Merchant@123456` |

A demo API key is also created and printed once to the seed script's console output — save it, it's not retrievable again.

## Common Commands

```bash
pnpm dev            # backend + frontend, watch mode
pnpm build           # build all packages
pnpm lint            # lint all packages
pnpm type-check      # type-check all packages
pnpm test            # unit + property-based tests (shared + backend)

# Backend-specific (from packages/backend)
pnpm test:integration        # requires Postgres running + migrated + seeded
pnpm prisma:studio           # visual DB browser
pnpm bench:run-all -- --light   # k6 benchmarks (requires k6 installed)
pnpm bench:fault-injection      # observability demo (requires Prometheus/Grafana running)
```

## Environment Variables of Note

| Variable | Default | Purpose |
|---|---|---|
| `IDEMPOTENCY_STRATEGY` | `optimistic` | `optimistic` \| `naive` \| `redis-lock` — never set `naive` outside benchmarking |
| `HMAC_VERIFICATION_ENABLED` | `false` | Enforce HMAC signatures on requests that carry `X-Signature` |
| `MOCK_GATEWAY_SUCCESS_RATE` | `0.95` | Simulated payment gateway success rate (0-1) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | General API rate limit (per window per IP) |

Full list: `.env.example`.

## Troubleshooting

- **Database connection errors**: confirm `docker compose ps` shows `postgres` healthy, and `DATABASE_URL` in both root `.env` and `packages/backend/.env` are correct.
- **TypeScript errors after a Prisma schema change**: run `pnpm prisma:generate` from `packages/backend`.
- **Port conflicts**: default ports are 3000 (frontend), 3001 (backend), 5432 (Postgres), 6379 (Redis), 5672/15672 (RabbitMQ), 9090 (Prometheus), 3002 (Grafana).
- **Migration conflicts in dev**: `cd packages/backend && npx prisma migrate reset` (destructive — wipes local dev data).
