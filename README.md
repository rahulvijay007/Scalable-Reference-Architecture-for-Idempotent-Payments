# Scalable Payment Processing Platform

A full-stack, enterprise-grade payment processing system built with modern technologies, demonstrating real-world fintech architecture, security, and scalability patterns.

## Research Artifact

This repository is also the artifact behind *"A Scalable Reference Architecture for Idempotent Payment Processing: Design, Security, and Observability in a Full-Stack Implementation."* The `research/` directory contains:

- **`research/formal-model/`** — a formal safety/liveness argument for the payment-authorization idempotency protocol (`idempotency-protocol.md`) and the full payment lifecycle state machine (`payment-state-machine.md`).
- **`research/security/threat-model.md`** — asset/attacker/mitigation analysis backing the security design, including one explicitly documented unfixed limitation.
- **`research/benchmarks/`** + **`research/results/`** — k6 load-testing scripts and real (not placeholder) output empirically comparing three idempotency-protocol implementations (naive/optimistic/redis-lock) under concurrency, plus an RBAC-overhead microbenchmark.
- **`research/related-work.md`** — a 2022+-only bibliography.
- **`research/REPRODUCE.md`** — exact steps to regenerate every number above from a clean environment.

The novel contribution: `payment.service.ts`'s original idempotency check had a real, demonstrable race condition (two concurrent requests could both pass the existence check before either inserted, crashing the loser into an unhandled `500`). This was fixed with a proven-correct "optimistic-retry" protocol, then empirically validated — both via property-based testing and via k6 load tests hitting a real database — against a naive baseline and a Redis-distributed-lock alternative. See `research/formal-model/idempotency-protocol.md` for the full argument.

## Project Overview

This platform provides a complete payment lifecycle management system with:

- **Payment Operations**: Authorization, Capture, Refund, and Reversal
- **Security**: JWT authentication, HMAC request signing, RBAC authorization
- **Scalability**: RabbitMQ message queues, Redis caching, horizontal scaling support
- **Observability**: Prometheus metrics, Grafana dashboards, ELK stack logging
- **Compliance**: Audit logging, PCI-DSS aligned practices

## Technology Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis
- **Message Queue**: RabbitMQ
- **Authentication**: JWT + HMAC
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK Stack (Elasticsearch, Logstash, Kibana)

### Frontend
- **Framework**: Next.js 14 with App Router
- **UI Library**: Material UI
- **State Management**: Zustand (client/auth state) + React Query (server state)

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Orchestration**: Kubernetes (manifests included)
- **Monorepo**: pnpm workspaces + Turbo

## Project Structure

```
.
├── packages/
│   ├── backend/           # Express.js API server
│   │   ├── src/
│   │   │   ├── config/    # Configuration management
│   │   │   ├── middleware/# Auth, RBAC, error handling, rate limiting
│   │   │   ├── routes/    # API routes
│   │   │   ├── services/  # Business logic
│   │   │   └── utils/     # Utilities and helpers
│   │   ├── prisma/        # Database schema and migrations
│   │   └── Dockerfile     # Container definition
│   ├── frontend/          # Next.js dashboard (login, payments, API keys)
│   └── shared/            # Shared types, utilities, and validation
├── infrastructure/        # Monitoring and logging configs
│   ├── grafana/
│   ├── prometheus/
│   └── logstash/
├── docker-compose.yml     # Local development environment
└── CLAUDE.md             # AI assistant guidance

```

## Getting Started

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **pnpm**: v8.0.0 or higher
- **Docker**: v24.0.0 or higher
- **Docker Compose**: v2.20.0 or higher

### Installation

1. **Clone the repository**:
   ```bash
   cd "Scalable Payment Processing API"
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start infrastructure services**:
   ```bash
   pnpm docker:up
   ```

   This starts:
   - PostgreSQL (port 5432)
   - Redis (port 6379)
   - RabbitMQ (port 5672, management UI on 15672)
   - Elasticsearch (port 9200)
   - Logstash (port 5000)
   - Kibana (port 5601)
   - Prometheus (port 9090)
   - Grafana (port 3002)

5. **Run database migrations**:
   ```bash
   cd packages/backend
   pnpm prisma:migrate
   ```

6. **Seed the database**:
   ```bash
   pnpm prisma:seed
   ```

   This creates:
   - Admin user: `admin@payment-platform.com` / `Admin@123456`
   - Merchant user: `merchant@payment-platform.com` / `Merchant@123456`
   - Demo merchant with API key

7. **Start the development server**:
   ```bash
   # From project root
   pnpm dev
   ```

   This starts both the backend API (`http://localhost:3001`) and the dashboard (`http://localhost:3000`) via Turborepo.

## API Documentation

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "MERCHANT",
      "permissions": ["CREATE_PAYMENT", ...]
    }
  }
}
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <accessToken>
```

### Payment Endpoints

All payment routes accept either a JWT bearer token (dashboard) or an `X-API-Key` header (programmatic access), and require the matching permission (`CREATE_PAYMENT`, `READ_PAYMENT`, `CAPTURE_PAYMENT`, `REFUND_PAYMENT`, `CANCEL_PAYMENT`).

```http
POST   /api/payments               # authorize a new payment (idempotencyKey required)
GET    /api/payments               # list payments (paginated, filterable by status)
GET    /api/payments/:id           # payment detail + transaction history
POST   /api/payments/:id/capture   # capture an authorized payment
POST   /api/payments/:id/refund    # refund a captured payment (full or partial)
POST   /api/payments/:id/cancel    # cancel a pending/authorized payment
```

Reusing the same `idempotencyKey` with an identical payload returns the original payment; reusing it with a different payload returns `409 IDEMPOTENCY_KEY_CONFLICT`.

### Merchant & API Key Endpoints

```http
GET    /api/merchants/:id
GET    /api/merchants/:id/api-keys
POST   /api/merchants/:id/api-keys   # returns the raw key once - it is never shown again
DELETE /api/merchants/:id/api-keys/:keyId
```

### Health & Metrics
```http
GET /health    # real DB/Redis/RabbitMQ connectivity checks
GET /ready     # Kubernetes readiness - fails if the database is unreachable
GET /live      # Kubernetes liveness
GET /metrics   # Prometheus scrape endpoint
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Start all services in development mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm type-check

# Docker commands
pnpm docker:up      # Start all services
pnpm docker:down    # Stop all services
pnpm docker:logs    # View logs

# Database commands (from packages/backend)
pnpm prisma:generate  # Generate Prisma client
pnpm prisma:migrate   # Run migrations
pnpm prisma:studio    # Open Prisma Studio
pnpm prisma:seed      # Seed database
```

## Monitoring & Observability

### Grafana Dashboards
Access Grafana at `http://localhost:3002`
- Username: `admin`
- Password: `admin`

### Prometheus Metrics
Access Prometheus at `http://localhost:9090`

### Kibana Logs
Access Kibana at `http://localhost:5601`

### RabbitMQ Management
Access RabbitMQ UI at `http://localhost:15672`
- Username: `admin`
- Password: `admin`

## Security Features

### Authentication
- JWT-based authentication with access and refresh tokens
- Refresh token rotation
- Token expiration and validation

### Authorization
- Role-Based Access Control (RBAC)
- Fine-grained permission system
- Resource ownership checks

### Request Signing
- HMAC-SHA256 request signature verification
- Timestamp-based replay attack prevention

### Data Protection
- Password hashing with bcrypt
- Sensitive data encryption (AES-256-GCM)
- Card number masking
- Audit logging for compliance

## Architecture Highlights

### Idempotency
All payment operations use idempotency keys to prevent duplicate processing, ensuring safe retries.

### Asynchronous Processing
RabbitMQ queues handle transaction processing asynchronously for improved scalability and reliability.

### Caching Strategy
Redis caches frequently accessed data, reducing database load and improving response times.

### Error Handling
Comprehensive error handling with structured error responses and detailed logging.

### Rate Limiting
API rate limiting protects against abuse and ensures fair usage.

## Testing & CI

```bash
pnpm --filter @payment-platform/shared test          # crypto + Luhn/validation unit tests
pnpm --filter @payment-platform/backend test          # unit tests (mocked Prisma/gateway)
pnpm --filter @payment-platform/backend test:integration  # full HTTP lifecycle against real Postgres
```

Integration tests require a migrated + seeded database (`docker compose up -d postgres`, then `pnpm prisma:migrate` and `pnpm prisma:seed` from `packages/backend`). GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check, both test suites, and a full build against a Postgres service container on every push/PR.

## Security Notes

- **Frontend token storage**: the dashboard currently stores JWT access/refresh tokens in `localStorage` (via Zustand's persist middleware), matching the backend's current behavior of returning tokens in the JSON response body. This is weaker to XSS than an httpOnly cookie. Upgrading to httpOnly cookies + CSRF protection is a known follow-up, not yet implemented.
- **Card data**: raw card numbers/CVVs are never persisted or logged - only `cardLast4`/`cardBrand` are stored, and Pino redaction (`utils/logger.ts`) strips card fields from any logged request body.
- **API keys**: only the raw key is returned once, at creation time; the database stores a SHA-256 hash plus a masked display value.

## Project Status

✅ **Completed**:
- Monorepo setup with pnpm workspaces
- TypeScript configuration
- Docker Compose with all services
- Express.js backend with middleware
- Prisma ORM with comprehensive schema
- JWT authentication system + API-key auth for programmatic access
- RBAC authorization
- Mock payment gateway
- Core payment lifecycle: authorize, capture, refund, cancel, with idempotency-key conflict detection
- Merchant API key management (create/list/revoke)
- Audit logging service
- Real health checks (`/health`, `/ready`) + Prometheus `/metrics`
- Pino log redaction for card/auth data
- Unit + integration test suites, GitHub Actions CI
- Next.js 14 + Material UI dashboard (login/register, payments list/detail, API key management)

🚧 **In Progress / Out of Scope for now**:
- RabbitMQ async processing (connectivity check only, no publishers/consumers)
- Redis caching (connectivity check only, no caching logic)
- Webhook delivery worker
- Kubernetes manifests
- httpOnly-cookie token storage

## Contributing

This is a demonstration project showcasing payment processing architecture and best practices.

## License

MIT License - see LICENSE file for details

## Support

For questions or issues, please refer to the CLAUDE.md file for development guidance.
