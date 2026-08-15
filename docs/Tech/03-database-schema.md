# Database Schema

PostgreSQL via Prisma ORM. Full source of truth: `packages/backend/prisma/schema.prisma`. All primary keys are UUIDs; money fields are `Decimal(19,4)`.

## Entity Overview

```
User ──belongs to──> Merchant
User ──has many──> RefreshToken
Merchant ──has many──> Payment, ApiKey, Webhook
Payment ──has many──> Transaction, WebhookEvent
Webhook ──has many──> WebhookDelivery
WebhookEvent ──has many──> WebhookDelivery
User ──has many──> AuditLog
```

## `User`
Authentication + role. `role`: `ADMIN | MERCHANT | DEVELOPER | SUPPORT`. Optional `merchantId` (nullable — admins/support aren't tied to one merchant).

## `RefreshToken`
One row per issued refresh token; `isRevoked` flips to `true` on logout or rotation (old token revoked when a new one is issued via `/api/auth/refresh`).

## `Merchant`
Business/tenant entity. `businessAddress` is a free-form JSON field.

## `ApiKey`
`key` stores a **masked** display value (`pk_****last4`); `keyHash` stores the SHA-256 hash used for lookup/verification. The raw key is never persisted — it's shown to the caller once, at creation.

## `Payment`
The central entity. Key fields:
- `status`: `PENDING | AUTHORIZED | CAPTURED | REFUNDED | PARTIALLY_REFUNDED | FAILED | CANCELLED | EXPIRED`
- `idempotencyKey`: unique — this constraint is what the idempotency protocol relies on for safety (see `docs/Tech/05-idempotency-protocol.md`)
- `cardLast4`, `cardBrand`, `cardExpMonth`, `cardExpYear`: derived/masked card data only — **raw PAN and CVV are never stored**
- `metadata`: JSON, includes an internal `_requestHash` used to detect idempotency-key reuse with a different payload

Indexed on `merchantId`, `status`, `idempotencyKey`, `createdAt`.

## `Transaction`
One row per lifecycle operation against a `Payment` (`type`: `AUTHORIZATION | CAPTURE | REFUND | REVERSAL`). The initial `AUTHORIZATION` transaction is created **atomically with its `Payment` row** (in the same DB transaction) — this is deliberate, not incidental; see the idempotency protocol doc for why.

## `Webhook` / `WebhookEvent` / `WebhookDelivery`
Schema exists for outbound webhook notification delivery with retry tracking (`attempts`, `nextRetryAt`). **Not currently wired to a delivery worker** — this is documented future work, not a bug.

## `AuditLog`
Append-only. One row per state-mutating payment operation (`action` values like `PAYMENT_CREATED`, `PAYMENT_CAPTURED`, `PAYMENT_REFUNDED`, `PAYMENT_CANCELLED`), plus `ipAddress`/`userAgent`/`details` for compliance traceability.

## Migrations

Managed via Prisma Migrate. From `packages/backend`:
```bash
pnpm prisma:migrate    # create + apply a new migration in dev
pnpm prisma:generate   # regenerate the Prisma Client after schema changes
pnpm prisma:studio     # visual DB browser
pnpm prisma:seed       # seed demo admin/merchant users + API key
```
