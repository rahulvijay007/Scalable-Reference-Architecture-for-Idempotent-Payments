# Security Architecture

Condensed developer-facing summary. Full asset/attacker/mitigation analysis: `research/security/threat-model.md`.

## Authentication

| Mechanism | Used for | Details |
|---|---|---|
| JWT | Dashboard (browser) traffic | Access token 15 min, refresh token 7 days, rotated on every refresh. `auth.middleware.ts` |
| API key | Programmatic/server-to-server callers | `X-API-Key` header, looked up by SHA-256 hash only (raw key never stored). `api-key.middleware.ts` |
| `authenticateAny` | Both routes accept either | Tries JWT first, falls back to API key. `api-key.middleware.ts` |

## Authorization (RBAC)

Two layers, deliberately redundant:
1. **Middleware layer** — `requirePermission()`, `requireRole()`, `requireMerchantAccess()` (`authorization.middleware.ts`), applied before the route handler runs.
2. **Service layer** — `assertMerchantAccess()` inside `payment.service.ts`, for routes like `GET /api/payments/:id` where the resource's owning merchant isn't known until after a DB lookup, so the middleware layer alone can't check it.

Permissions are defined once in `packages/shared/src/types/auth.types.ts` (`Permission` enum + `ROLE_PERMISSIONS` map) and consumed identically by both middleware and the frontend's UI-gating logic.

## Request Signing (HMAC)

`hmac.middleware.ts`'s `verifyHmac` checks a SHA-256 HMAC signature over `{method, path, timestamp, body}`, plus a 5-minute timestamp freshness window. Opt-in via `HMAC_VERIFICATION_ENABLED=true`, and only enforced on requests that actually carry an `X-Signature` header (`conditionalHmac`), so it layers on top of JWT/API-key auth without breaking unsigned callers.

**Known, documented limitation**: no replay-nonce tracking. A captured valid signature can be replayed verbatim within the 5-minute window. See threat model for the reasoning behind leaving this unfixed (scope decision, not an oversight) and what closing it would require (a Redis-backed used-signature store).

## Card Data Handling

- Raw PAN/CVV exist only in-memory for the duration of a single request, passed directly to the payment gateway service, **never written to the database or logs**.
- Only `cardLast4`, `cardBrand`, `cardExpMonth`, `cardExpYear` are persisted.
- Pino's `redact` config (`utils/logger.ts`, exported as `LOG_REDACT_CONFIG`) strips card fields and auth headers from any logged object — including the full request body the generic error handler logs on failure.

## Idempotency as a Security Property

Beyond correctness, the idempotency protocol prevents duplicate-charge abuse: a retried or replayed payment-creation request with the same key either returns the original result or is rejected outright (`409`) if the payload doesn't match — it can never create a second charge. See `docs/Tech/05-idempotency-protocol.md`.

## Rate Limiting

- General API: 100 requests/minute per IP (`apiLimiter`)
- Auth endpoints (`/register`, `/login`): 5 attempts/15 minutes per IP (`authLimiter`)

## Known Gaps (tracked, not hidden)

- HMAC replay-nonce tracking (above)
- No RabbitMQ/async processing — all payment operations are synchronous within the request
- No webhook delivery worker — `WebhookDelivery` retry fields exist in the schema but nothing consumes them yet
- Frontend stores JWTs in `localStorage` (via Zustand persist), not an httpOnly cookie — weaker to XSS; documented tradeoff, not an oversight
