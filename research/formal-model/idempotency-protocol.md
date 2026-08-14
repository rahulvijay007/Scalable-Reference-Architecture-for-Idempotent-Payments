# A Concurrency-Safe Idempotent-Authorization Protocol for Payment APIs

## 1. Problem statement

`POST /api/payments` accepts a caller-supplied `idempotencyKey` (UUID) so that
retried or duplicated requests — the normal case in any network client that
retries on timeout — do not create duplicate payment authorizations. The
system must guarantee, under arbitrary concurrency, that:

- **Safety** — at most one `Payment` row is ever created for a given
  `idempotencyKey`.
- **Liveness** — every caller, including every concurrent duplicate caller,
  eventually receives a definitive, well-formed response: either the
  authorization result (`201`), the previously-created payment
  (`200`-equivalent), or an explicit conflict (`409 IDEMPOTENCY_KEY_CONFLICT`
  if the same key was reused with a different payload).

## 2. The naive protocol and its failure mode

The original implementation performed:

```
existing := SELECT Payment WHERE idempotencyKey = k
if existing exists:
    return reconcile(existing)
payment := INSERT Payment (idempotencyKey = k, ...)
return payment
```

`Payment.idempotencyKey` carries a database-level `UNIQUE` constraint, so a
truly duplicate row can never physically exist — but the *read* and the
*write* above are two separate round trips, not one atomic operation. Given
two concurrent requests `R1`, `R2` with the same key `k`:

1. `R1` executes `SELECT ... WHERE idempotencyKey = k` → no row found.
2. `R2` executes `SELECT ... WHERE idempotencyKey = k` → no row found (before `R1`'s insert commits).
3. `R1` executes `INSERT ...` → succeeds.
4. `R2` executes `INSERT ...` → **rejected by the UNIQUE constraint** (Postgres error `23505`, surfaced by Prisma as `PrismaClientKnownRequestError` code `P2002`).

The naive protocol never catches this error. It propagates out of the
service layer as an unhandled exception, and the generic branch of
`errorHandler` (`error.middleware.ts`) converts it into an opaque
`500 INTERNAL_SERVER_ERROR`. This **violates the liveness property**: `R2`'s
caller receives a response that is neither the authorization result nor a
well-defined conflict — just a generic server error indistinguishable from
an unrelated bug, with no indication that `R1`'s authorization actually
succeeded. A naive retry-on-500 client would then retry `R2` and either
succeed (now `existing` is visible) or spuriously retry again — the protocol
provides no bound on how many round trips this takes.

Safety is never violated by the naive protocol (the database constraint sees
to that), but a protocol that only provides safety and not liveness is not a
usable idempotency guarantee from the caller's point of view.

## 3. Strategy 1 — Optimistic-retry (production default)

```
existing := SELECT Payment WHERE idempotencyKey = k
if existing exists:
    return reconcile(existing)
try:
    payment := INSERT Payment (idempotencyKey = k, ...)
    return payment
catch UniqueConstraintViolation:
    winner := SELECT Payment WHERE idempotencyKey = k   // must now exist
    return reconcile(winner)
```

**Safety.** Unchanged from the naive protocol — it is a direct consequence of
the database's own atomicity and uniqueness guarantee for a single `INSERT`
statement, independent of anything the application layer does before or
after it. No strategy in this document can violate safety; they differ only
in how gracefully they handle the conflict the database detects.

**Liveness.** By construction, every code path terminates in one of exactly
three outcomes: (a) `reconcile(existing)` on the first read, (b) a
successful insert, or (c) `reconcile(winner)` after catching the constraint
violation. `winner` is guaranteed to exist at that point: the only way
`INSERT` can fail with a unique-constraint violation on `idempotencyKey` is
if a row with that key already exists, and Postgres does not allow that row
to be deleted mid-transaction by a concurrent `DELETE` in this schema (no
delete path exists for `Payment` in the current API surface). Each of the
three outcomes calls `reconcile`, which itself is total: it either returns a
value or throws the well-defined `409 IDEMPOTENCY_KEY_CONFLICT`. No path
reaches an unhandled exception.

**Cost.** In the contended case, one extra `SELECT` round trip. In the
uncontended (overwhelmingly common) case, identical cost to the naive
protocol — no lock acquisition, no additional infrastructure dependency.

## 4. Strategy 2 — Pessimistic Redis lock (comparison baseline)

```
lock := Redis SET idempotency-lock:k <token> NX PX ttl
if not lock:
    return 423 LOCKED
try:
    existing := SELECT Payment WHERE idempotencyKey = k
    if existing exists:
        return reconcile(existing)
    payment := INSERT Payment (idempotencyKey = k, ...)
    return payment
finally:
    Redis EVAL "if GET(key)==token then DEL(key) end" idempotency-lock:k <token>
```

**Safety.** Also holds — trivially, since only one holder can ever execute
the critical section at a time, so the race in §2 cannot occur at all (this
is belt-and-suspenders on top of the database constraint, which still holds
independently).

**Liveness — conditional.** Liveness holds only if:
1. Redis itself is available (an outage causes every request to fail with
   `423 LOCKED` after `LOCK_ACQUIRE_ATTEMPTS` retries — the protocol
   **fails closed**, unlike optimistic-retry which has no such dependency).
2. `IDEMPOTENCY_LOCK_TTL_MS` is set comfortably larger than the critical
   section's real duration. If the critical section (which includes the DB
   round trip) legitimately runs longer than the TTL, the lock can expire
   while still logically "in use," and a second caller can acquire it and
   race the first — reopening exactly the hazard this strategy exists to
   close, just with a much smaller and less deterministic window than the
   naive protocol's.
3. A holder that crashes mid-section does not release the lock explicitly;
   the TTL is the *only* mechanism that frees it for other callers. This is
   a standard, accepted property of single-instance lease-based locks and is
   why the release script only ever deletes a lock it still owns (comparing
   the stored token) — it must never release a lock that TTL-expired and was
   re-acquired by someone else in the meantime.

This is a single-Redis-instance design; it does not attempt the multi-node
Redlock protocol (or its published critiques) since this system has exactly
one Redis instance and that broader treatment is out of scope here.

**Cost.** Every request pays for a lock acquisition and release round trip
to Redis (two extra network hops beyond the DB work), plus a new
infrastructure dependency in the request's critical path.

## 5. Comparison summary

| Strategy       | Safety | Liveness                             | Extra infra | Added latency source        | Failure mode under Redis outage |
|-----------------|:------:|----------------------------------------|:------------:|------------------------------|----------------------------------|
| Naive           | ✅     | ❌ (unhandled 500 on contention)       | none         | none                          | n/a (doesn't use Redis)          |
| Optimistic-retry| ✅     | ✅ (unconditional)                     | none         | 1 extra SELECT, only on conflict | n/a (doesn't use Redis)     |
| Redis-lock      | ✅     | ✅ *iff* TTL ≫ critical-section time and Redis is up | Redis  | lock acquire+release round trips, every request | fails closed (423) |

**Conclusion**: optimistic-retry provides the same safety as the lock-based
alternative, strictly stronger unconditional liveness than both alternatives,
lower steady-state cost, and no additional infrastructure dependency. It is
the production default (`IDEMPOTENCY_STRATEGY=optimistic`). The naive and
redis-lock strategies are retained in `packages/backend/src/services/idempotency/`
purely as empirical comparison baselines for `research/benchmarks/` — see
`research/benchmarks/k6/idempotency-race.js` and
`research/results/` for the measured correctness and latency data under
concurrent load.

## 6. A refinement found by property-based testing

The initial implementation of §3 created the `Payment` row first and only
created its `Transaction` row later, *after* the gateway call. Property-based
testing (`payment.state-machine.pbt.test.ts`) surfaced a residual race this
introduces: a losing caller that reconciles against the winner's `Payment`
row immediately after the P2002 catch can observe that row before the
winner's (still in-flight, gateway-call-dependent) `Transaction` row exists,
making `reconcile()` fail with a spurious `500` even under the optimistic
protocol. This was not visible from code review alone - it only appeared
once the property test exercised genuine concurrent interleavings.

The fix: `Payment` and its initial (`PENDING`) `AUTHORIZATION` `Transaction`
are now created together in a single atomic database transaction
(`prisma.$transaction(async (tx) => ...)`), so any row visible to a
`findExisting()` call is guaranteed to already have a transaction to
reconcile against. The gateway call and its outcome are applied afterward as
an `update` to that same transaction row, not a second `create`. This closes
the gap without changing the safety/liveness arguments above - it simply
makes their "the row you observe is complete" precondition actually hold.

This episode is included here deliberately: it is evidence that the
property-based test suite does real verification work rather than merely
restating the implementation, and is the kind of finding worth reporting in
an evaluation section as evidence of the testing methodology's value, not
just its results.

## 7. Threats to validity

- These are informal proof sketches appropriate to a systems paper, not
  mechanized proofs (no TLA+/Coq model). The safety argument leans entirely
  on the RDBMS's documented atomicity/uniqueness guarantee for a single
  `INSERT`, which is a standard, well-established property, not something
  this work re-derives.
- The mock payment gateway (`payment-gateway.service.ts`) is not itself
  idempotent — a retried gateway call after a successful authorization would
  create a second gateway-side charge in a real (non-mock) integration. This
  protocol only guarantees idempotency at the `Payment` row level, i.e., it
  guarantees the *gateway is called at most once per idempotency key* by
  construction (the gateway call happens only after the strategy has
  established a uniquely-created row), which is the property that matters —
  but this is worth stating explicitly rather than leaving implicit.
