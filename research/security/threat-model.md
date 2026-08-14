# Threat Model

## 1. Assets

| Asset | Where it lives | Sensitivity |
|---|---|---|
| Card data | Never persisted beyond `cardLast4`/`cardBrand`/`cardExpMonth`/`cardExpYear` (`prisma/schema.prisma` `Payment` model). Raw PAN/CVV exist only in-memory for the duration of a single request, passed straight to `paymentGateway.authorize()` (`payment-gateway.service.ts`) and never written to the database or logs. | Critical |
| JWT access/refresh tokens | Issued by `auth.service.ts`; access tokens are short-lived (`config.jwt.accessTokenExpiry`, default 15m), refresh tokens are stored server-side (`RefreshToken` table) and rotated on use. | High |
| API keys | `ApiKey.keyHash` (SHA-256 of the raw key) is what's stored and checked; the raw key is shown to the caller exactly once, at creation (`api-key.service.ts`). | High |
| Merchant/payment data | Scoped per-merchant; cross-merchant access is denied at two independent layers (see §3). | High |
| Audit logs | `AuditLog` table, written by `auditService.log()` on every payment mutation. | Medium (compliance-relevant, not itself secret) |

## 2. Attacker capabilities considered

- **Unauthenticated network attacker** — can send arbitrary HTTP requests to any exposed endpoint, cannot present a valid JWT, API key, or HMAC signature.
- **Authenticated-wrong-merchant attacker** — holds valid credentials (JWT or API key) for merchant A, attempts to read/mutate merchant B's data.
- **Under-privileged authenticated attacker** — holds valid credentials for a role lacking a specific permission (e.g. `SUPPORT` attempting `CREATE_PAYMENT`).
- **Replay attacker** — has captured a previously-valid request (e.g. an HMAC-signed payload) and resends it.
- **Log-exfiltration attacker** — has read access to application logs (e.g. via a compromised log aggregator) and attempts to recover sensitive data from them.
- **Concurrency attacker** — deliberately fires many simultaneous requests with the same idempotency key, hoping to force duplicate authorization or an inconsistent state.

## 3. Threats and mitigations

| Threat (STRIDE-ish) | Mitigation | Where |
|---|---|---|
| **Spoofing** identity via a forged/expired JWT | Signature verification + expiry check on every request | `auth.middleware.ts` (`authenticate`) |
| **Spoofing** identity via a stolen/invalid API key | Key is looked up by SHA-256 hash (never by raw value), `isActive`/`expiresAt` checked, `lastUsedAt` updated for audit trail | `api-key.middleware.ts` (`authenticateApiKey`) |
| **Tampering** with request payload/parameters | HMAC-SHA256 signature over `{method, path, timestamp, body}`, verified with a timing-safe comparison | `hmac.middleware.ts` (`verifyHmac`); opt-in via `config.hmac.enabled` and only enforced when an `X-Signature` header is present (`conditionalHmac`), so it layers on top of JWT/API-key auth without breaking callers that don't sign. `verifyHmacSignature` (`crypto.utils.ts`) explicitly length-checks both buffers before calling `crypto.timingSafeEqual`, which otherwise throws on length mismatch instead of returning false - a tampered signature of different length would crash into an unhandled `500` rather than a `401` without this guard; caught and fixed during adversarial testing (`security.adversarial.integration.test.ts`). |
| **Tampering/Replay** — reusing a captured signature within the freshness window | Timestamp-window check (`timeDiff > 5 * 60 * 1000` rejected) | `hmac.middleware.ts` |
| **Tampering/Replay** — reusing a captured signature *within* the freshness window | **Known limitation, not mitigated in this artifact.** `verifyHmac` checks that the timestamp is recent, but does not track which `(signature, timestamp)` pairs have already been consumed. A captured valid request can be replayed verbatim any number of times within the ~5-minute window. Closing this requires a shared (e.g. Redis-backed) used-signature store with a TTL matching the freshness window, checked and written atomically per request. Deliberately left as documented future work rather than folded into this artifact's scope (see `research/formal-model/idempotency-protocol.md` for the related-but-distinct idempotency-key protocol, which *does* fully close its analogous replay gap - the difference being that idempotency-key handling is designed to make replays a safe no-op, whereas HMAC replay protection is designed to reject the replay outright, a different and unimplemented mechanism here). |
| **Elevation of privilege** — calling an endpoint without the required permission | Permission/role checks before the handler runs | `authorization.middleware.ts` (`requirePermission`, `requireRole`) |
| **Elevation of privilege** — cross-merchant data access | Two independent layers: (1) middleware-level `requireMerchantAccess()` for routes where the merchant ID is a URL param/body field, (2) service-layer `assertMerchantAccess()` in `payment.service.ts` for routes like `GET/POST /api/payments/:id/*` where the merchant ID isn't known until the payment is loaded from the database. Admin role bypasses both, by design. | `authorization.middleware.ts`, `payment.service.ts` |
| **Information disclosure** via application logs | Pino `redact` configuration strips `cardNumber`, `cvv`, `authorization` header, and `x-api-key` header from any logged object, including the full-request-body logging in the generic error handler | `utils/logger.ts`, exercised by `error.middleware.ts`'s `errorHandler` |
| **Information disclosure** via API responses | Card data in responses is always the masked/derived form (`cardLast4`, `cardBrand`); raw PAN/CVV are never included in any `ApiResponse<T>` payload | `payment.service.ts` (`createPayment` closure only stores masked fields) |
| **Double-processing** — duplicate payment authorization from a retried/duplicated request | Idempotency-key protocol (safety guaranteed by the DB unique constraint under every strategy; liveness guaranteed under `optimistic`/`redis-lock`) | `services/idempotency/`, see `research/formal-model/idempotency-protocol.md` |
| **Double-processing** — same idempotency key reused with a materially different payload | Canonical request-hash comparison; mismatch is rejected with `409 IDEMPOTENCY_KEY_CONFLICT` rather than silently processed | `payment.service.ts` (`hashIdempotentRequest`, `reconcile`) |
| **Repudiation** — a merchant/user denying they performed a payment action | Every state-mutating operation (create/capture/refund/cancel) writes an `AuditLog` entry with `userId`, `action`, `resourceId`, `ipAddress`, `userAgent` | `auditService.log()` calls throughout `payment.service.ts` |
| **Denial of service** via request flooding | General API rate limiting (100 req/min default) and a stricter auth-endpoint limiter (5 attempts/15min) | `rate-limit.middleware.ts` |

## 4. Explicitly out of scope

- Multi-node distributed-lock correctness (Redlock-style analysis) - the Redis-lock idempotency strategy is evaluated as a single-Redis-instance design only (see `idempotency-protocol.md` §4).
- Card-network-level fraud detection (this system integrates with a mock gateway, not a real card network).
- Infrastructure-level threats (TLS termination, network segmentation, container/host hardening) - out of scope for an application-layer artifact.
- PCI-DSS certification - card-data-minimization practices here are *aligned with* PCI-DSS principles (never storing PAN/CVV) but this artifact makes no certification claim.
