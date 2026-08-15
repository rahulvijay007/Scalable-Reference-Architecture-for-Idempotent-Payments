# Idempotency Protocol (Developer Summary)

This is the project's core technical contribution. Full formal treatment (safety/liveness proofs, comparison table): `research/formal-model/idempotency-protocol.md`. This page is the practitioner-oriented summary.

## The Problem

`POST /api/payments` accepts a caller-supplied `idempotencyKey` so retried/duplicated requests don't double-charge. The original implementation did:

```
existing = SELECT WHERE idempotencyKey = k
if existing: return existing
payment = INSERT (idempotencyKey = k, ...)
```

Two concurrent requests with the same key can both see `existing = null` before either commits its `INSERT`. The database's `UNIQUE` constraint on `idempotencyKey` rejects the second insert — but the original code didn't catch that error, so the losing request crashed with an unhandled `500`.

## The Fix: Optimistic-Retry (production default)

```
existing = SELECT WHERE idempotencyKey = k
if existing: return reconcile(existing)
try:
    payment = INSERT (idempotencyKey = k, ...)
    return payment
catch UniqueConstraintViolation (Prisma P2002):
    winner = SELECT WHERE idempotencyKey = k   # now guaranteed to exist
    return reconcile(winner)
```

`reconcile()` compares a hash of the request's meaningful fields (`merchantId`, `amount`, `currency`, `paymentMethod`) against a hash stored on the original row: match → return the original result; mismatch → `409 IDEMPOTENCY_KEY_CONFLICT`.

**Safety** (at most one `Payment` row per key) is guaranteed by the database constraint regardless of strategy. **Liveness** (every caller gets a definitive response) only holds for this strategy and the lock-based alternative below — the naive version can leave a caller with nothing but a crash.

## A Subtler Race, Found by Testing

Even after the fix above, a losing request reconciling *immediately* after the P2002 catch could observe the winner's `Payment` row before the winner had gotten around to creating its `Transaction` row (which used to happen later, after the gateway call). Fix: **`Payment` and its initial `AUTHORIZATION` `Transaction` are now created together, atomically**, in one DB transaction. Both are guaranteed to exist together before either is ever visible to another request. This was caught by property-based concurrency testing, not code review — see `packages/backend/src/services/payment.state-machine.pbt.test.ts`.

## Strategy Comparison

| Strategy | File | Safety | Liveness | Extra infra |
|---|---|:---:|:---:|:---:|
| `naive` (benchmark-only, never production) | `naive.strategy.ts` | ✅ | ❌ | none |
| `optimistic` (production default) | `optimistic.strategy.ts` | ✅ | ✅ | none |
| `redis-lock` (comparison baseline) | `redis-lock.strategy.ts` | ✅ | ✅ *(iff TTL ≫ critical-section time)* | Redis |

Selected via `IDEMPOTENCY_STRATEGY` env var (default `optimistic`), dependency-injected into `PaymentService`.

## Empirical Results

Real k6 load test, concurrency=10, identical concurrent requests sharing one key:

| Strategy | Payment rows created | Requests with a definitive response |
|---|:---:|:---:|
| naive | 1 | **1 / 10** |
| optimistic | 1 | 10 / 10 |
| redis-lock | 1 | 10 / 10 |

Full results: `research/results/`. Reproduce: `pnpm bench:run-all` from `packages/backend` (see `research/REPRODUCE.md`).

## Extending This

To add a fourth strategy: implement `IdempotencyStrategy` (`idempotency-strategy.ts`'s interface — `run(ctx)` given `findExisting`/`reconcile`/`createPayment` callbacks), register it in `services/idempotency/index.ts`'s `createIdempotencyStrategy()` factory, and add it to the `IdempotencyStrategyName` union type.
