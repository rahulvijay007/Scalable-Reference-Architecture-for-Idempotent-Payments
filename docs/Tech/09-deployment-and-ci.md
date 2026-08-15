# Deployment & CI

## Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `main`:

1. Checkout, pnpm/Node setup
2. `pnpm install --frozen-lockfile`
3. `prisma generate` + `prisma migrate deploy` against a Postgres service container
4. `pnpm lint`
5. `pnpm type-check`
6. Shared package tests
7. Backend unit tests
8. Backend integration tests
9. `pnpm build`

## Container Image (backend)

`packages/backend/Dockerfile` — multi-stage build:
1. **Builder stage**: installs full workspace deps, generates the Prisma client, builds `shared` then `backend`.
2. **Production stage**: installs production-only deps, copies built `dist/` output and the generated Prisma client, copies the Prisma schema (needed for `migrate deploy` at release time), sets `NODE_ENV=production`, exposes port 3001, includes a container `HEALTHCHECK` against `GET /health`.

```bash
docker build -f packages/backend/Dockerfile -t payment-backend .
docker run -p 3001:3001 --env-file .env payment-backend
```

## Environment-Specific Configuration

All configuration is environment-variable-driven (`packages/backend/src/config/index.ts`) — no code changes needed between environments. Notable production concerns:

- **Secrets**: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `HMAC_SECRET`, `API_KEY_ENCRYPTION_KEY` must be set to real random values — the committed defaults are placeholders for local dev only.
- **Migrations**: use `prisma migrate deploy` (not `migrate dev`) in a release step — it applies pending migrations without generating new ones or prompting interactively.
- **`IDEMPOTENCY_STRATEGY`**: must be `optimistic` (the default) in production. `naive` and `redis-lock` exist for research/benchmarking only.
- **CORS**: `CORS_ORIGIN` must be set to the actual deployed frontend origin, not the local-dev default.

## What's Not Yet Built (explicitly out of scope, not forgotten)

- Kubernetes manifests — none exist yet; the Dockerfile and `/health`/`/ready`/`/live` endpoints are designed to be K8s-probe-compatible, but manifests themselves are future work.
- RabbitMQ-based async processing — the service is defined in `docker-compose.yml` but no publisher/consumer code exists.
- Webhook delivery worker — schema exists (`Webhook`/`WebhookEvent`/`WebhookDelivery`), no worker consumes it.
- Redis caching — only used today for the `redis-lock` idempotency strategy and a health-check ping, not for actual response caching.

## Frontend Deployment

`packages/frontend` is a standard Next.js 14 app (`next build` / `next start`) — deployable to any Node hosting target or platform with native Next.js support. Requires `NEXT_PUBLIC_API_URL` pointed at the deployed backend.
