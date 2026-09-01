# Limitations and Threats to Validity

A single, consolidated accounting of every limitation, known gap, and
scope boundary documented across this research artifact. Individual
sections of `research/` note their own limitations inline, close to the
claim they qualify — this document exists so a reviewer (or the paper's
own Limitations section) doesn't have to reconstruct the full picture from
five separate files. Every item below links back to its source of record;
nothing here is a new claim, only a consolidated index of existing ones.

## 1. Formal-model limitations

- **The database-atomicity axiom is not itself re-derived.** Both the
  prose proof and the TLA+ models (`formal-model/idempotency-protocol.md`
  §7, `formal-model/formal-proof.md` §6) take PostgreSQL's documented
  atomicity/uniqueness guarantee for a single `INSERT` under a `UNIQUE`
  constraint as an axiom, not something this work independently verifies.
  This is standard practice (no systems paper re-proves its RDBMS's ACID
  guarantees) but is stated explicitly rather than left implicit.
- **The Redis-lock strategy is modeled and reasoned about informally, not
  in TLA+.** `IdempotentPayment.tla` covers the naive and optimistic
  strategies only; the Redis-lock strategy's liveness is _conditional_
  (dependent on real-valued TTL-vs-critical-section-duration timing), which
  isn't naturally expressible in TLA+'s untimed model without a
  timed-automata extension — out of scope here, per
  `formal-model/formal-proof.md` §6. This gap is _not_ left purely
  theoretical, though: it's the one covered empirically instead (§3 below).
- **TLA+ model-checking is bounded, not unbounded.** `IdempotentPayment.tla`
  is exhaustively checked at 3 and 5 concurrent requesters;
  `PaymentStateMachine.tla` at `MaxAmount` = 3 and 5. The safety proof in
  `formal-proof.md` §3 is a general inductive argument that holds for any
  `N` (it doesn't depend on the bound), so the bounded checks are
  corroborating evidence for an already-general proof, not a substitute —
  but this is worth restating plainly: TLC did not check every possible
  `N`, because no model checker can.
- **Multi-node Redlock correctness is explicitly out of scope.** This
  system has exactly one Redis instance; the published Redlock safety
  debate (Kleppmann's critique and Redis's response) doesn't apply to a
  single-instance lock and isn't engaged with here
  (`related-work.md` §4, `security/threat-model.md` §4).

## 2. Empirical/benchmark limitations

- **Single-process, single-machine reference deployment.** All benchmark
  results (`results/README.md`, `results/scaled/README.md`) are measured
  against one unclustered Node.js process and one local Postgres/Redis
  instance. The scaled-benchmark sweep (`results/scaled/README.md`)
  reports an honest throughput ceiling around VUS=100–250 on this specific
  deployment — that ceiling is a property of _this reference
  implementation's_ resource limits, not of the idempotency protocol,
  which never produced an incorrect or undefined response at any tier
  tested (zero lifecycle errors across 1,250+ requests). A horizontally
  scaled production deployment would move that ceiling; this artifact does
  not claim otherwise.
- **Mock payment gateway, not a real card network.** `payment-gateway.service.ts`
  is a configurable-latency, configurable-success-rate mock. The protocol's
  guarantee (§idempotency-protocol.md, restated in `formal-proof.md` §7)
  is that the gateway is called _at most once_ per idempotency key by
  construction — but the mock gateway is not itself idempotent, so a real
  (non-mock) gateway integration would need its own idempotency handling on
  retried gateway-side calls, which this artifact does not model or test.
- **The lock-expiry fault injection uses a synthetic delay.** As documented
  in `results/README.md` and the docstring of
  `packages/backend/scripts/fault-injection-lock-expiry.ts`, the
  vulnerable condition requires `IDEMPOTENCY_DEBUG_CRITICAL_SECTION_DELAY_MS`
  (off by default everywhere else) because the real gateway call happens
  _after_ the lock is released, so the lock's actual critical section is
  normally fast. This means the experiment demonstrates the _strategy's_
  documented weakness under a deliberately adverse but synthetic condition
  — it is not a claim that this specific deployment's real gateway latency
  would trigger the same failure today (it empirically does not, at the
  gateway latencies tested; see the "not merely a theoretical concern" note
  the experiment adds to `formal-model/idempotency-protocol.md` §4).
- **Statistical rigor is applied to one strategy at one deployment.** The
  5-repeats-per-tier variance reporting (`results/scaled/README.md`) covers
  the `optimistic` strategy only, since it's the production default; the
  `naive`/`redis-lock` throughput comparisons in `results/README.md` remain
  single-run figures. The qualitative safety/liveness finding (which is
  the paper's central claim) does not depend on this, since it's already
  confirmed independently by the TLA+ exhaustive search
  (`formal-proof.md`) and by the property-based tests — the variance
  reporting specifically strengthens the _quantitative_ throughput claim,
  not the correctness claim.

## 3. Security limitations

- **HMAC replay-within-window is a known, unmitigated gap.**
  `security/threat-model.md` §3: a captured valid HMAC-signed request can
  be replayed verbatim within the ~5-minute freshness window. Closing this
  requires a shared used-signature store with a TTL matching the freshness
  window — deliberately left as documented future work, not folded into
  this artifact's scope, and explicitly distinguished there from the
  idempotency-key protocol (which _does_ fully close its own,
  differently-shaped replay gap by design, since a duplicate idempotency
  key is a safe no-op rather than something that must be rejected outright).
- **`EXPIRED` payment status has no producing transition.**
  `formal-model/payment-state-machine.md` §1 and §6: no background job
  expires stale `AUTHORIZED` payments past a TTL. A real deployment would
  need one (banks typically hold an authorization for ~7 days); out of
  scope for this artifact.
- **Infrastructure-level threats are out of scope.**
  `security/threat-model.md` §4: TLS termination, network segmentation,
  and container/host hardening are not addressed — this is an
  application-layer artifact by design.
- **No PCI-DSS certification claim.** `security/threat-model.md` §4:
  card-data-minimization practices (never storing PAN/CVV) are _aligned
  with_ PCI-DSS principles but this is not a certification and should not
  be read as one.
- **Card-network-level fraud detection is out of scope.**
  `security/threat-model.md` §4: this system integrates with a mock
  gateway, not a real card network, and does not attempt fraud scoring.

## 4. Scope boundaries (by design, not oversight)

- **This is a single-service idempotency mechanism, not a distributed-saga
  or cross-service-transaction system.** `related-work.md` §5 positions
  this explicitly against the Saga-pattern literature: this project
  guarantees correctness for one service's request-level deduplication,
  not cross-service compensating-transaction orchestration.
- **The Stripe baseline comparison (`related-work.md` §11) is qualitative
  only.** Stripe does not publish the internal mechanism behind its
  documented idempotency behavior, so no mechanism-level comparison against
  this project's three strategies is possible from public information —
  only the externally observable outcome is compared.

## 5. Summary table

| Limitation                                       | Status                                  | Where documented                                       |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------ |
| DB atomicity taken as axiom                      | By design (standard practice)           | `formal-model/idempotency-protocol.md` §7              |
| Redis-lock strategy not in TLA+                  | Compensated empirically instead         | `formal-model/formal-proof.md` §6, `results/README.md` |
| Model checking is bounded (N=3,5)                | Corroborates a general proof            | `formal-model/formal-proof.md` §3                      |
| Multi-node Redlock correctness                   | Out of scope                            | `related-work.md` §4                                   |
| Single-process deployment ceiling                | Honestly measured & reported            | `results/scaled/README.md`                             |
| Mock gateway not itself idempotent               | Documented, unmitigated                 | `formal-model/formal-proof.md` §7                      |
| Lock-expiry fault injection uses synthetic delay | Documented, clearly labeled             | `results/README.md`                                    |
| Variance reporting covers `optimistic` only      | Documented scope                        | `results/scaled/README.md`                             |
| HMAC replay-within-window                        | **Known limitation, unmitigated**       | `security/threat-model.md` §3                          |
| `EXPIRED` status unreachable                     | Out of scope / future work              | `formal-model/payment-state-machine.md` §6             |
| Infrastructure-level threats                     | Out of scope                            | `security/threat-model.md` §4                          |
| PCI-DSS certification                            | Not claimed                             | `security/threat-model.md` §4                          |
| Cross-service/Saga transactions                  | Out of scope by design                  | `related-work.md` §5                                   |
| Stripe comparison is qualitative-only            | Documented limitation of the comparison | `related-work.md` §11                                  |
