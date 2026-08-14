# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack, enterprise-grade **Scalable Payment Processing Platform** demonstrating real-world fintech architecture. The system supports complete payment lifecycles (Authorization → Capture → Refund → Reversal) with enterprise security, scalability, and observability.

**Tech Stack**: Node.js/TypeScript monorepo with Express.js backend, PostgreSQL, Redis, RabbitMQ, Prometheus/Grafana, ELK stack, Docker/Kubernetes.

## Architecture Overview

### Monorepo Structure
- **packages/backend**: Express.js REST API with JWT auth, RBAC, payment processing
- **packages/frontend**: Next.js dashboard (in development)
- **packages/shared**: Common TypeScript types, Zod schemas, crypto utilities
- **infrastructure/**: Prometheus, Grafana, Logstash configurations

### Key Architecture Patterns

**Idempotency**: All payment operations use `idempotencyKey` (UUID) to prevent duplicate processing. Check database for existing operations before creating new ones.

**Async Processing**: RabbitMQ queues handle authorization → capture → settlement flows. Workers consume messages and update payment status asynchronously.

**Security Layers**:
1. JWT authentication (15-minute access tokens, 7-day refresh tokens)
2. RBAC with permissions (ADMIN, MERCHANT, DEVELOPER, SUPPORT roles)
3. HMAC request signing for API calls (SHA-256, 5-minute replay protection)
4. Audit logging for all payment operations

**Database Schema** (Prisma):
- `User`, `Merchant`, `ApiKey`: Auth and tenant management
- `Payment`, `Transaction`: Payment lifecycle tracking
- `Webhook`, `WebhookEvent`, `WebhookDelivery`: Webhook management
- `AuditLog`: Compliance and audit trail

## Common Development Commands

### Setup & Installation
```bash
pnpm install                    # Install all dependencies
pnpm docker:up                  # Start infrastructure (PostgreSQL, Redis, RabbitMQ, etc.)
cd packages/backend && pnpm prisma:migrate  # Run database migrations
cd packages/backend && pnpm prisma:seed     # Seed demo data
```

### Development
```bash
pnpm dev                        # Start all services in watch mode
pnpm build                      # Build all packages
pnpm type-check                 # TypeScript type checking
pnpm lint                       # Lint all packages
pnpm format                     # Format code with Prettier
pnpm test                       # Run tests
```

### Database Operations (from packages/backend)
```bash
pnpm prisma:generate            # Generate Prisma client after schema changes
pnpm prisma:migrate             # Create and run new migration
pnpm prisma:studio              # Open Prisma Studio GUI
pnpm prisma:seed                # Seed database with demo data
```

### Docker Management
```bash
pnpm docker:up                  # Start all services
pnpm docker:down                # Stop all services
pnpm docker:logs                # View logs from all services
```

## Service Endpoints (Local Development)

- **Backend API**: http://localhost:3001
- **PostgreSQL**: localhost:5432 (user: postgres, password: postgres)
- **Redis**: localhost:6379
- **RabbitMQ**: localhost:5672 (Management UI: http://localhost:15672, admin/admin)
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3002 (admin/admin)
- **Kibana**: http://localhost:5601
- **Elasticsearch**: http://localhost:9200

## Code Organization Principles

### Backend Structure
```
packages/backend/src/
├── config/          # Environment config (config/index.ts)
├── middleware/      # Express middleware (auth, RBAC, error handling, rate limiting)
├── routes/          # API route definitions
├── services/        # Business logic layer (payment, auth, database, gateway)
├── utils/           # Logger, helpers
└── index.ts         # Server entry point
```

### Adding New Endpoints
1. Define types in `packages/shared/src/types/`
2. Create service in `packages/backend/src/services/`
3. Create route in `packages/backend/src/routes/`
4. Register route in `packages/backend/src/app.ts`
5. Add middleware: `authenticate`, `requirePermission()`, `requireMerchantAccess()`

Example:
```typescript
import { authenticate, requirePermission } from '../middleware/auth.middleware';
import { Permission } from '@payment-platform/shared';

router.post('/payments',
  authenticate,
  requirePermission(Permission.CREATE_PAYMENT),
  asyncHandler(async (req, res) => {
    // Implementation
  })
);
```

### Error Handling
Use `AppError` class for business logic errors:
```typescript
import { AppError } from '../middleware/error.middleware';

throw new AppError(400, 'INVALID_AMOUNT', 'Payment amount must be positive');
```

Use `asyncHandler` wrapper for async route handlers to automatically catch errors.

### Database Patterns
- Always use `prisma` from `services/database.service`
- Use transactions for multi-step operations
- Include audit logging for sensitive operations
- Use `select` to avoid exposing sensitive fields (passwords, tokens)

### Logging
Use structured logging with Pino:
```typescript
import { logger } from '../utils/logger';

logger.info({ userId, paymentId }, 'Payment authorized');
logger.error({ error, context }, 'Payment processing failed');
```

## Payment Processing Workflow

### Authorization Flow
1. Validate request (Zod schema validation)
2. Check idempotency key (prevent duplicates)
3. Validate card details (Luhn algorithm)
4. Call payment gateway service
5. Create `Payment` and `Transaction` records
6. Publish to RabbitMQ for async processing
7. Return authorization response

### Capture Flow
1. Find authorized payment
2. Validate capture amount ≤ authorized amount
3. Call gateway capture API
4. Update payment status to CAPTURED
5. Create capture transaction record
6. Trigger webhook event

### Refund Flow
1. Find captured payment
2. Validate refund amount ≤ captured amount
3. Call gateway refund API
4. Update payment status (REFUNDED or PARTIALLY_REFUNDED)
5. Create refund transaction record
6. Trigger webhook event

## Security & Compliance Guidelines

### Payment Data Handling
- **NEVER log**: Full card numbers, CVV, raw card data
- **Always mask**: Card numbers (show last 4 digits only)
- **Encrypt**: Sensitive fields using `encrypt()` from shared/utils
- **Hash**: API keys before storing (use `hashData()`)

### Authentication Patterns
```typescript
// Protect routes requiring authentication
router.get('/payments', authenticate, handler);

// Require specific permission
router.post('/payments', authenticate, requirePermission(Permission.CREATE_PAYMENT), handler);

// Require admin role
router.delete('/users/:id', authenticate, requireRole(UserRole.ADMIN), handler);

// Ensure merchant ownership
router.get('/payments/:id', authenticate, requireMerchantAccess(), handler);
```

### Audit Logging
Log all payment operations:
```typescript
import { auditService } from '../services/audit.service';

await auditService.log({
  userId: req.user.userId,
  action: 'PAYMENT_AUTHORIZED',
  resource: 'PAYMENT',
  resourceId: payment.id,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  details: { amount, currency }
});
```

## Testing Approach

### Unit Tests
- Test services in isolation with mocked dependencies
- Test utility functions (crypto, validation)
- Test middleware logic

### Integration Tests
- Test API endpoints end-to-end
- Use test database (separate from development)
- Test authentication and authorization flows

### Test Data
After running `pnpm prisma:seed`:
- Admin: admin@payment-platform.com / Admin@123456
- Merchant: merchant@payment-platform.com / Merchant@123456
- API Key will be displayed in seed output

## Important Conventions

- All API responses follow `ApiResponse<T>` format from shared types
- Use Zod schemas for request validation (defined in shared package)
- Timestamps are ISO 8601 strings
- Currency amounts stored as Decimal(19,4) in database
- Use UUIDs for all primary keys
- HTTP status codes: 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 500 (Internal Server Error)

## Troubleshooting

**Database connection issues**: Ensure PostgreSQL is running (`pnpm docker:up`) and DATABASE_URL in .env is correct

**TypeScript errors after schema change**: Run `pnpm prisma:generate` to regenerate Prisma client

**Port conflicts**: Check if ports 3001, 5432, 6379, 5672 are available

**Authentication errors**: Ensure JWT_SECRET is set in .env and tokens haven't expired

**Migration conflicts**: Reset database with `cd packages/backend && npx prisma migrate reset`

## Next Development Steps

Remaining high-priority tasks:
1. Complete payment service implementation (authorize, capture, refund endpoints)
2. Set up RabbitMQ publishers and consumers
3. Implement Redis caching for payment lookups
4. Add Prometheus metrics collection
5. Create webhook delivery system
6. Build Next.js frontend dashboard
7. Add comprehensive test suite
8. Create Kubernetes deployment manifests
