# API Reference

Base URL (local dev): `http://localhost:3001`

All responses use the envelope:
```json
{ "success": true, "data": { ... }, "metadata": { "timestamp": "..." } }
```
or, on error:
```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} }, "metadata": { "timestamp": "..." } }
```

## Authentication

Every endpoint under `/api/payments` and `/api/merchants` accepts **either**:
- `Authorization: Bearer <accessToken>` (JWT, obtained via login) — used by the dashboard
- `X-API-Key: <key>` — used by programmatic/server-to-server callers

Optionally, requests can also be HMAC-signed (`X-Signature` + `X-Timestamp` headers); enforced only when `HMAC_VERIFICATION_ENABLED=true` and the header is present.

### `POST /api/auth/register`
Body: `{ email, password, firstName, lastName, role?, merchantId? }` → `{ accessToken, refreshToken, user }`

### `POST /api/auth/login`
Body: `{ email, password }` → `{ accessToken, refreshToken, user }`

### `POST /api/auth/refresh`
Body: `{ refreshToken }` → new `{ accessToken, refreshToken, user }` (old refresh token is revoked)

### `POST /api/auth/logout`
Auth required. Body: `{ refreshToken }` → revokes the refresh token.

### `GET /api/auth/me`
Auth required. → current user's profile + permissions.

## Payments

Permission required per route, in parentheses.

### `POST /api/payments` (`CREATE_PAYMENT`)
```json
{
  "merchantId": "uuid",
  "amount": 100.50,
  "currency": "USD",
  "paymentMethod": "CREDIT_CARD",
  "cardDetails": { "cardNumber": "...", "expiryMonth": 12, "expiryYear": 2030, "cvv": "123", "cardholderName": "..." },
  "idempotencyKey": "uuid"
}
```
Returns the created (or, on identical replay, the original) payment + its authorization transaction. A repeated `idempotencyKey` with a **different** payload returns `409 IDEMPOTENCY_KEY_CONFLICT`.

### `GET /api/payments` (`READ_PAYMENT`)
Query params: `page`, `limit`, `status`, `merchantId` (admin only). Paginated list.

### `GET /api/payments/:id` (`READ_PAYMENT`)
Payment detail including full transaction history.

### `POST /api/payments/:id/capture` (`CAPTURE_PAYMENT`)
Body: `{ amount? }` (defaults to full authorized amount). Requires payment to be `AUTHORIZED`.

### `POST /api/payments/:id/refund` (`REFUND_PAYMENT`)
Body: `{ amount?, reason? }` (defaults to full remaining captured amount). Requires payment to be `CAPTURED` or `PARTIALLY_REFUNDED`.

### `POST /api/payments/:id/cancel` (`CANCEL_PAYMENT`)
Body: `{ reason? }`. Requires payment to be `PENDING` or `AUTHORIZED`.

## Merchants & API Keys

### `GET /api/merchants/:id` (`READ_MERCHANT`)
### `GET /api/merchants/:id/api-keys` (`READ_API_KEY`)
### `POST /api/merchants/:id/api-keys` (`CREATE_API_KEY`)
Body: `{ name, permissions? }`. **Returns the raw API key exactly once** — only a masked form (`pk_****last4`) is ever retrievable again.
### `DELETE /api/merchants/:id/api-keys/:keyId` (`REVOKE_API_KEY`)

## Operational Endpoints

| Route | Purpose | Auth |
|---|---|---|
| `GET /health` | Real DB/Redis/RabbitMQ connectivity check | none |
| `GET /ready` | Kubernetes readiness (fails if DB unreachable) | none |
| `GET /live` | Kubernetes liveness | none |
| `GET /metrics` | Prometheus scrape endpoint | none |
| `GET /api/_bench/rbac-check` | Benchmark-only, no-op route for isolating RBAC middleware cost | auth required |

## Roles & Permissions

| Role | Notable permissions |
|---|---|
| `ADMIN` | all permissions |
| `MERCHANT` | full payment lifecycle, API key management, own-merchant data |
| `DEVELOPER` | payment lifecycle + API key management, no merchant management |
| `SUPPORT` | read-only: payments, merchants, users, audit logs |

Full mapping: `packages/shared/src/types/auth.types.ts` (`ROLE_PERMISSIONS`).

## Common Error Codes

| Code | HTTP status | Meaning |
|---|---|---|
| `MISSING_TOKEN` / `MISSING_CREDENTIALS` | 401 | No JWT or API key supplied |
| `TOKEN_EXPIRED` / `INVALID_TOKEN` | 401 | JWT problem |
| `INVALID_API_KEY` / `EXPIRED_API_KEY` | 401 | API key problem |
| `INVALID_SIGNATURE` / `EXPIRED_REQUEST` | 401 | HMAC problem |
| `INSUFFICIENT_PERMISSIONS` | 403 | Authenticated, but lacks the required permission |
| `MERCHANT_ACCESS_DENIED` | 403 | Authenticated, but resource belongs to a different merchant |
| `PAYMENT_NOT_FOUND` | 404 | No such payment |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key, different payload |
| `INVALID_PAYMENT_STATE` | 409 | Requested operation isn't valid for the payment's current status |
| `INVALID_CARD` | 400 | Failed Luhn/expiry/CVV validation |
| `REFUND_EXCEEDS_REMAINING` | 400 | Refund amount exceeds what's left to refund |
| `LOCKED` | 423 | (redis-lock strategy only) concurrent request for the same key already in flight |
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
