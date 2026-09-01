# Payment Lifecycle: Formal State Machine

## 1. States

States are `PaymentStatus` (`packages/shared/src/types/payment.types.ts`):

| State                | Terminal? | Meaning                                                                                                                                                                                                                                                          |
| -------------------- | :-------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING`            |    no     | Row created, gateway authorization not yet attempted (transient — in the current implementation `createAndAuthorize` moves out of this state within the same request, before returning)                                                                          |
| `AUTHORIZED`         |    no     | Gateway authorization succeeded; funds reserved, not yet captured                                                                                                                                                                                                |
| `CAPTURED`           |    no     | Full amount captured; can still be (partially) refunded                                                                                                                                                                                                          |
| `PARTIALLY_REFUNDED` |    no     | Some, but not all, of the captured amount has been refunded                                                                                                                                                                                                      |
| `REFUNDED`           |  **yes**  | The full captured amount has been refunded                                                                                                                                                                                                                       |
| `FAILED`             |  **yes**  | Gateway authorization failed                                                                                                                                                                                                                                     |
| `CANCELLED`          |  **yes**  | A pending/authorized payment was reversed before capture                                                                                                                                                                                                         |
| `EXPIRED`            |     —     | **Gap**: defined in the schema and shared enum but no code path in `payment.service.ts` ever produces or checks this state. There is no authorization-expiry job/TTL. Documented here explicitly as a known limitation / future-work item, not silently omitted. |

## 2. Transitions

Extracted directly from the guard conditions enforced in `packages/backend/src/services/payment.service.ts`:

| From                            | Action (method)            | Guard                                                                                 | Gateway outcome | To                                                       |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- | :-------------: | -------------------------------------------------------- |
| `PENDING`                       | `createAndAuthorize`       | fresh payment (no idempotency replay)                                                 |     success     | `AUTHORIZED`                                             |
| `PENDING`                       | `createAndAuthorize`       | fresh payment                                                                         |     failure     | `FAILED`                                                 |
| `AUTHORIZED`                    | `capture`                  | `status === AUTHORIZED` (else `409 INVALID_PAYMENT_STATE`)                            |     success     | `CAPTURED`                                               |
| `AUTHORIZED`                    | `capture`                  | same                                                                                  |     failure     | `AUTHORIZED` (unchanged; `502` returned, retry possible) |
| `CAPTURED`                      | `refund` (full)            | `status ∈ {CAPTURED, PARTIALLY_REFUNDED}` and `amount ≤ remaining` (else `409`/`400`) |     success     | `REFUNDED`                                               |
| `CAPTURED`                      | `refund` (partial)         | same                                                                                  |     success     | `PARTIALLY_REFUNDED`                                     |
| `PARTIALLY_REFUNDED`            | `refund` (remaining)       | same                                                                                  |     success     | `REFUNDED`                                               |
| `PARTIALLY_REFUNDED`            | `refund` (further partial) | same                                                                                  |     success     | `PARTIALLY_REFUNDED`                                     |
| `CAPTURED`/`PARTIALLY_REFUNDED` | `refund`                   | same                                                                                  |     failure     | unchanged; `502` returned                                |
| `PENDING`/`AUTHORIZED`          | `cancel`                   | `status ∈ {PENDING, AUTHORIZED}` (else `409`)                                         |     success     | `CANCELLED`                                              |
| `PENDING`/`AUTHORIZED`          | `cancel`                   | same                                                                                  |     failure     | unchanged; `502` returned                                |

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

## 5. Machine-checked verification (TLA+)

Sec3's two structural invariants (No-invalid-transition, Refund-sum
invariant) are cross-checked against a **machine-checked** TLA+ model —
[`tla/PaymentStateMachine.tla`](tla/PaymentStateMachine.tla) — verified
with the TLC model checker, the same tool used for the idempotency
protocol's model (see [`formal-proof.md`](formal-proof.md)). Raw transcripts
are in [`tla/tlc-output-payment-state-machine.txt`](tla/tlc-output-payment-state-machine.txt)
(`MaxAmount=3`, 14 reachable states) and
[`tla/tlc-output-payment-state-machine-n5.txt`](tla/tlc-output-payment-state-machine-n5.txt)
(`MaxAmount=5`, 18 reachable states) — reproduction command in
[`../REPRODUCE.md`](../REPRODUCE.md).

**What's modeled**: the ValidEdges set in the spec is Sec2's transition
table restated as data rather than prose (every `<<from, to>>` pair
directly transcribed, including the failure-path self-loops from Sec4's
second known gap). A `ValidTransition` invariant then checks, at every one
of TLC's exhaustively-explored reachable states, that the step just taken
is literally a member of that set — a direct machine-checked version of
the No-invalid-transition claim, not merely a restatement of the guard
logic that could pass vacuously. `RefundSumInvariant` checks the
refund-sum property. `TerminalStaysTerminal` checks that `REFUNDED`,
`FAILED`, and `CANCELLED` really are dead ends, exactly as Sec1's
"Terminal?" column claims.

**Confirming the check isn't vacuous**: before trusting a "no error found"
result, one edge (`CAPTURED → PARTIALLY_REFUNDED`, i.e. a partial refund)
was deliberately deleted from `ValidEdges` as a negative control. TLC
immediately reported a `ValidTransition` violation with a 4-step witness
trace reaching exactly that transition — confirming the invariant actually
constrains the model rather than trivially passing. This deleted-edge
version was not committed; only the correct, restored model that produced
the clean transcripts above is checked in.

**Result**: all three properties hold across every reachable state at both
`MaxAmount=3` and `MaxAmount=5` — TLC's "No error has been found" is an
exhaustive-search result over the full modeled state space (nondeterministic
gateway success/failure on every capture/refund/cancel attempt, and every
possible partial-refund amount up to `MaxAmount`), not a sampled check.

## 6. Known gaps (explicit, not silently ignored)

- `EXPIRED` has no producing transition. A real deployment would need a
  background job to expire stale `AUTHORIZED` payments past some TTL (banks
  typically hold an authorization for 7 days); this is out of scope for the
  current artifact and is listed as future work.
- `capture`/`refund`/`cancel` failures leave the payment in its prior state
  rather than moving it to `FAILED` — this is a deliberate design choice
  (a failed capture attempt shouldn't destroy the ability to retry capturing
  an otherwise-valid authorization) but means `FAILED` is reachable only
  from the very first authorization attempt, never from a later operation.
