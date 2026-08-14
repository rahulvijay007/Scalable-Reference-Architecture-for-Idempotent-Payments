# Payment Lifecycle: Formal State Machine

## 1. States

States are `PaymentStatus` (`packages/shared/src/types/payment.types.ts`):

| State                | Terminal? | Meaning |
|-----------------------|:---------:|---------|
| `PENDING`              | no        | Row created, gateway authorization not yet attempted (transient — in the current implementation `createAndAuthorize` moves out of this state within the same request, before returning) |
| `AUTHORIZED`           | no        | Gateway authorization succeeded; funds reserved, not yet captured |
| `CAPTURED`             | no        | Full amount captured; can still be (partially) refunded |
| `PARTIALLY_REFUNDED`   | no        | Some, but not all, of the captured amount has been refunded |
| `REFUNDED`             | **yes**   | The full captured amount has been refunded |
| `FAILED`               | **yes**   | Gateway authorization failed |
| `CANCELLED`            | **yes**   | A pending/authorized payment was reversed before capture |
| `EXPIRED`              | —         | **Gap**: defined in the schema and shared enum but no code path in `payment.service.ts` ever produces or checks this state. There is no authorization-expiry job/TTL. Documented here explicitly as a known limitation / future-work item, not silently omitted. |

## 2. Transitions

Extracted directly from the guard conditions enforced in `packages/backend/src/services/payment.service.ts`:

| From                 | Action (method)      | Guard                                                        | Gateway outcome | To                    |
|-----------------------|-----------------------|---------------------------------------------------------------|:---------------:|------------------------|
| `PENDING`              | `createAndAuthorize`  | fresh payment (no idempotency replay)                          | success          | `AUTHORIZED`           |
| `PENDING`              | `createAndAuthorize`  | fresh payment                                                   | failure          | `FAILED`               |
| `AUTHORIZED`           | `capture`              | `status === AUTHORIZED` (else `409 INVALID_PAYMENT_STATE`)     | success          | `CAPTURED`             |
| `AUTHORIZED`           | `capture`              | same                                                            | failure          | `AUTHORIZED` (unchanged; `502` returned, retry possible) |
| `CAPTURED`             | `refund` (full)        | `status ∈ {CAPTURED, PARTIALLY_REFUNDED}` and `amount ≤ remaining` (else `409`/`400`) | success | `REFUNDED` |
| `CAPTURED`             | `refund` (partial)     | same                                                            | success          | `PARTIALLY_REFUNDED`   |
| `PARTIALLY_REFUNDED`   | `refund` (remaining)   | same                                                            | success          | `REFUNDED`             |
| `PARTIALLY_REFUNDED`   | `refund` (further partial) | same                                                       | success          | `PARTIALLY_REFUNDED`   |
| `CAPTURED`/`PARTIALLY_REFUNDED` | `refund`      | same                                                            | failure          | unchanged; `502` returned |
| `PENDING`/`AUTHORIZED` | `cancel`               | `status ∈ {PENDING, AUTHORIZED}` (else `409`)                  | success          | `CANCELLED`            |
| `PENDING`/`AUTHORIZED` | `cancel`               | same                                                            | failure          | unchanged; `502` returned |

Every other (state, action) pair not listed above is rejected by an explicit
guard before any state mutation is attempted (e.g. `capture` on a `CAPTURED`
payment, `refund` on a `PENDING` payment, `cancel` on a `CAPTURED` payment) —
the service throws `AppError(409, 'INVALID_PAYMENT_STATE', ...)` and the
`Payment` row is left untouched. This table is therefore a complete
specification of every state-mutating transition the service permits.

## 3. Invariants

Independent of any single transition, the following must hold for every
`Payment` at all times (these are exactly what Phase 2's property-based
tests check):

1. **No-invalid-transition** — the sequence of `status` values a `Payment`
   passes through over its lifetime is always a walk along the edges in §2;
   no code path can move a payment directly between two states that aren't
   connected by a listed transition (e.g. `PENDING → CAPTURED` directly is
   impossible — capture always requires having passed through `AUTHORIZED`
   first).
2. **Refund-sum invariant** — the sum of all successful `REFUND`-type
   `Transaction.amount` values for a payment never exceeds `Payment.amount`
   (enforced by the `remaining` check in `refund()`).
3. **Idempotency invariant** (Phase 1) — at most one `Payment` row is ever
   created per `idempotencyKey`, regardless of concurrency, under the
   `optimistic` and `redis-lock` strategies (violated only by the
   intentionally-buggy `naive` strategy under contention).

## 4. Known gaps (explicit, not silently ignored)

- `EXPIRED` has no producing transition. A real deployment would need a
  background job to expire stale `AUTHORIZED` payments past some TTL (banks
  typically hold an authorization for 7 days); this is out of scope for the
  current artifact and is listed as future work.
- `capture`/`refund`/`cancel` failures leave the payment in its prior state
  rather than moving it to `FAILED` — this is a deliberate design choice
  (a failed capture attempt shouldn't destroy the ability to retry capturing
  an otherwise-valid authorization) but means `FAILED` is reachable only
  from the very first authorization attempt, never from a later operation.
