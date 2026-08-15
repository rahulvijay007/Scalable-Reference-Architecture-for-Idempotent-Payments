# Architecture Overview

## Monorepo Structure

pnpm workspaces + Turborepo, three packages:

```
packages/
  shared/    Zod schemas, TypeScript types/enums, crypto & validation utilities
  backend/   Express.js REST API (TypeScript, Prisma/PostgreSQL)
  frontend/  Next.js 14 (App Router) + Material UI dashboard
```

`shared` has no runtime dependency on the other two; both `backend` and `frontend` depend on it as `@payment-platform/shared` (workspace dependency), so request/response shapes, enums, and validation rules are defined once and consumed identically on both sides of the network boundary.

## Backend Layering

```
routes/       Express routers - request validation, permission checks, calls into services
middleware/   auth, RBAC, HMAC, rate limiting, error handling, metrics, request logging
services/     business logic (payment lifecycle, auth, audit, API keys, gateway, idempotency)
config/       centralized environment configuration
utils/        logger, shared helpers
```

Each route handler is thin: validate input → check permission → delegate to a service → shape the response as `ApiResponse<T>`. All business logic and Prisma access lives in `services/`.

## Request Flow (example: `POST /api/payments`)

1. `helmet`, `cors`, JSON body parsing, `compression` (global middleware, `app.ts`)
2. `requestLogger` + `metricsMiddleware` (Pino structured log + Prometheus histogram)
3. `apiLimiter` (rate limiting)
4. `authenticateAny` — tries JWT bearer token first, falls back to `X-API-Key` header
5. `conditionalHmac` — optional HMAC signature verification (only enforced if `X-Signature` header present and `HMAC_VERIFICATION_ENABLED=true`)
6. Route validators (`express-validator`)
7. `requirePermission(CREATE_PAYMENT)` / `requireMerchantAccess()`
8. `payment.service.ts`'s `createAndAuthorize()` — idempotency check, card validation, gateway call, DB writes, audit log, metrics
9. `errorHandler` catches anything thrown along the way and shapes it into the standard error envelope

## Payment Lifecycle

```
PENDING --authorize--> AUTHORIZED --capture--> CAPTURED --refund--> PARTIALLY_REFUNDED / REFUNDED
   |                        |
   +--(failure)--> FAILED   +--(cancel)--> CANCELLED
```

Full transition table with guard conditions: `research/formal-model/payment-state-machine.md`.

## Idempotency Protocol

Payment creation is protected by a pluggable `IdempotencyStrategy` (`packages/backend/src/services/idempotency/`), selected via `IDEMPOTENCY_STRATEGY` env var:

- **`optimistic`** (production default) — read-then-insert, catching the database's unique-constraint violation on conflict and reconciling against the concurrent winner. No extra infrastructure dependency.
- **`redis-lock`** — pessimistic distributed lock around the same critical section. Comparison baseline only.
- **`naive`** — the original (buggy) implementation, kept only for benchmarking. **Never use in production.**

Full design rationale and correctness argument: `research/formal-model/idempotency-protocol.md`.

## Data Model

PostgreSQL via Prisma. Core entities: `User`, `Merchant`, `ApiKey`, `Payment`, `Transaction`, `Webhook`/`WebhookEvent`/`WebhookDelivery`, `AuditLog`. See `02-database-schema.md` for details.

## Infrastructure (Docker Compose)

| Service | Purpose | Used by default? |
|---|---|---|
| PostgreSQL | primary datastore | yes |
| Redis | idempotency lock (redis-lock strategy only) | opt-in |
| RabbitMQ | defined, not wired into app logic | no (future work) |
| Prometheus | scrapes `GET /metrics` | for observability demo |
| Grafana | dashboards on top of Prometheus | for observability demo |
| Elasticsearch/Logstash/Kibana | log aggregation stack | defined, not wired into app logic |

## Frontend

Next.js App Router, Material UI components, Zustand for client/auth state, React Query for server state. Talks to the backend via a typed `fetch` wrapper (`lib/api-client.ts`) that handles JWT refresh transparently. Reuses `@payment-platform/shared`'s Zod schemas for client-side form validation, so validation rules never drift between frontend and backend.

## Security Layers (defense in depth)

1. JWT (15-min access / 7-day refresh, rotation on refresh) or API key (SHA-256 hashed, never stored raw) authentication
2. Role-based permission checks (middleware layer)
3. Merchant-ownership checks (middleware layer *and* service layer, since some routes only know the resource's merchant after a DB lookup)
4. Optional HMAC request signing with a replay-window check
5. Structured log redaction (card data, tokens, API keys never reach log output)

Full threat model: `research/security/threat-model.md`.
