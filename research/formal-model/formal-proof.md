# Formal Verification of the Idempotent-Authorization Protocol

This document restates the argument in [`idempotency-protocol.md`](idempotency-protocol.md)
as explicit theorems and proofs, and cross-checks it against a **machine-checked**
TLA+ model — [`tla/IdempotentPayment.tla`](tla/IdempotentPayment.tla) — verified with
the TLC model checker (TLA+ Tools v2.19). This is intentionally in addition to,
not a replacement for, the prose argument: the prose explains *why* in terms a
systems reader can follow against the actual code; this document exists so a
formal-methods reviewer has a precise, checkable artifact to evaluate instead
of having to trust prose alone. Raw TLC transcripts are in
[`tla/tlc-output-naive.txt`](tla/tlc-output-naive.txt),
[`tla/tlc-output-optimistic.txt`](tla/tlc-output-optimistic.txt), and
[`tla/tlc-output-optimistic-n5.txt`](tla/tlc-output-optimistic-n5.txt) —
nothing below is asserted without a corresponding line in one of those files.
Reproduction commands are in [`../REPRODUCE.md`](../REPRODUCE.md).

## 1. System model

Let `K` be a single idempotency key and `R = {r_1, ..., r_n}` a set of
concurrent requesters presenting `K` to `POST /api/payments`. Model each
requester's execution as a sequence of at most three observable events
against the shared database state `rowExists(K) : Bool`:

- **read** — evaluates `rowExists(K)` at the instant it executes.
- **insert** — atomically tests-and-sets `rowExists(K): false → true`;
  succeeds iff `rowExists(K) = false` at the instant it executes (this
  atomicity is the one primitive borrowed directly from the DBMS, per
  PostgreSQL's documented guarantee for a single `INSERT` under a `UNIQUE`
  constraint — it is not re-derived here, consistent with §7 of
  `idempotency-protocol.md`).
- **handle-conflict** — executes only if `insert` failed; its behavior is
  the one place the *Naive* and *Optimistic* strategies diverge.

Every requester's control flow is `read → (insert | reconcile-existing)`,
and for those that reach a failed `insert`, `→ handle-conflict`. This is
exactly the abstraction encoded as the `Read`, `InsertAttempt`,
`ReconcileExisting`, `HandleConflictNaive`, and `HandleConflictOptimistic`
actions in the TLA+ spec — the mapping from code to model is direct enough
that each action's comment cites the corresponding line(s) of
`idempotency-protocol.md`.

## 2. Properties

**Definition (Safety).** A protocol execution is *safe* if at most one
requester's `insert` ever succeeds for a given key `K`.

**Definition (Liveness).** A protocol execution is *live* if every requester
eventually reaches a terminal outcome in `{authorized, reconciled}` — i.e.,
excludes `unhandledError` as a possible terminal outcome for any requester.

These correspond exactly to `Safety` and `NoUnhandledError` in the TLA+
spec, and to the Safety/Liveness properties stated in §1 of
`idempotency-protocol.md`.

## 3. Theorem 1 (Safety, both strategies)

**Claim.** For any `R`, any interleaving of `read`/`insert`/`handle-conflict`
events, and either strategy (Naive or Optimistic), at most one requester's
`insert` succeeds.

**Proof.** `insert` succeeds iff `rowExists(K) = false` at the instant it
executes, and every successful `insert` sets `rowExists(K) := true`
atomically as part of the same instant (Postgres `UNIQUE` constraint
enforcement is a single atomic operation with no observable intermediate
state — this is the one axiom this proof relies on, and it is a standard,
documented DBMS guarantee, not a claim being newly established here). Hence
after the first successful `insert`, `rowExists(K) = true` holds
permanently (no requester ever sets it back to `false` — there is no delete
path in the model, matching the production API surface, per §3 of
`idempotency-protocol.md`), so every subsequent `insert` attempt observes
`rowExists(K) = true` and fails by definition. Therefore at most one
`insert` ever succeeds. This argument does not depend on `handle-conflict`'s
behavior at all, which is exactly why Safety holds identically for both
strategies. ∎

**Machine check.** TLC verified `Safety` as an invariant — checked at every
one of the 3,157 distinct states reachable with `|R| = 5` under the
Optimistic strategy (`tlc-output-optimistic-n5.txt`), and at every state
reachable with `|R| = 3` under both strategies. TLC performs *exhaustive*
state-space exploration up to the modeled bound, not sampling — "no error
has been found" for an invariant means the invariant provably holds across
every one of those reachable states, not merely the ones a test run
happened to hit.

## 4. Theorem 2 (Liveness, Optimistic strategy only)

**Claim.** Under the Optimistic strategy, every requester eventually reaches
a terminal outcome in `{authorized, reconciled}`.

**Proof.** By Theorem 1, for any requester `r` whose `insert` fails, some
other requester's `insert` already succeeded, so `rowExists(K) = true` holds
from that point forward (permanently, per Theorem 1's proof). `r`'s
`handle-conflict` step under the Optimistic strategy re-evaluates
`rowExists(K)`, observes `true`, and reconciles against the existing row —
this always terminates in outcome `reconciled`, by construction of
`HandleConflictOptimistic` (there is no further branch, retry loop, or
failure path in this action). Every requester therefore reaches exactly one
of: `reconcile-existing` directly (outcome `reconciled`), a successful
`insert` (outcome `authorized`), or `handle-conflict` after a failed
`insert` (outcome `reconciled`). All three are terminal and none is
`unhandledError`. ∎

**Corollary (Naive strategy violates Liveness).** Under the Naive strategy,
`HandleConflictNaive` unconditionally sets outcome to `unhandledError` with
no further branch — so *any* reachable state in which two or more
requesters' `read` events both observe `rowExists(K) = false` before either
completes its `insert` (i.e., a genuine race) leads to a requester
terminating with `unhandledError`. Such a state is reachable whenever
`|R| ≥ 2` (trivially: two requesters both `read` before either `insert`s).

**Machine check.** TLC's exhaustive search over the Naive-strategy model
(`|R| = 3`) found this exact violation at search depth 6 and printed the
full witness trace (`tlc-output-naive.txt`): two requesters both observe
`rowExists(K) = false`, one succeeds at `insert`, the other's `insert`
fails and `HandleConflictNaive` drives it to `outcome = unhandledError`.
This is not a hypothetical — it is the same interleaving the production bug
(§2 of `idempotency-protocol.md`) exhibits, restated in the model and
confirmed reachable by exhaustive search rather than by inspection.
Conversely, TLC's exhaustive search over the Optimistic-strategy model
(`|R| = 3`, then independently re-verified at `|R| = 5` across 3,157
states) found **zero** violations of `NoUnhandledError` — every reachable
terminal state has every requester's outcome in `{authorized, reconciled}`,
confirming Theorem 2 across the full modeled state space, not just the
interleaving exercised by the property-based test in
`payment.state-machine.pbt.test.ts`.

## 5. What this adds beyond the prose argument and the property-based tests

Three independent lines of evidence now support the same conclusion, each
catching a different class of error:

1. **Prose proof** (`idempotency-protocol.md`) — explains *why*, tied
   directly to the real TypeScript/Prisma code and its actual error types
   (`P2002`, `23505`). Best for a reader auditing the implementation.
2. **Machine-checked model** (this document) — proves the *abstraction* is
   correct by exhaustive search over its full reachable state space, not
   sampled interleavings, and is immune to the kind of reasoning error a
   human proof-writer (or reviewer) can make by accident. Best for a formal
   verification reviewer, and the only one of the three that can be
   independently re-run by a third party with `java -jar tla2tools.jar` and
   no access to this codebase at all.
3. **Property-based tests** (`payment.state-machine.pbt.test.ts`) and
   **empirical benchmarks** (`research/results/`) — confirm the *real
   system*, including everything the TLA+ model deliberately abstracts away
   (the actual HTTP layer, the actual Prisma transaction, the actual
   gateway call, real network timing), exhibits the same behavior the model
   and proof predict. This is what caught the residual race described in
   §6 of `idempotency-protocol.md` — a bug in the *implementation's fidelity
   to the model*, not in the model or proof themselves, which is precisely
   the class of error neither the prose proof nor the TLA+ model (both of
   which model the *intended* protocol) could have caught on their own.

None of the three is redundant with the others; each closes a gap the other
two cannot.

## 6. Threats to validity (unchanged from, and consistent with, §7 of `idempotency-protocol.md`)

- The TLA+ model abstracts the database's `INSERT` as a single atomic
  test-and-set. This is a faithful abstraction of PostgreSQL's documented
  `UNIQUE`-constraint behavior for a single-statement `INSERT`, but the
  model does not itself verify that guarantee — it is taken as an axiom,
  exactly as the prose proof does.
- The model does not include the Redis-lock strategy. Its liveness is
  already stated as *conditional* (§4 of `idempotency-protocol.md`,
  dependent on TTL-vs-critical-section-duration and Redis availability),
  which is not a property amenable to the same kind of unconditional
  exhaustive-search argument without modeling real-valued timing — doing so
  rigorously (e.g., with a timed-automata formalism) is out of scope here
  and is noted as future work rather than silently skipped.
- `Requesters` is checked at `|R| = 3` and `|R| = 5`, not for unbounded `R`.
  The Safety proof in §3 above is a general inductive argument that holds
  for any `R` (it does not depend on `|R|`), so the bounded model-check is
  corroborating evidence for an already-general proof, not a substitute for
  one — this is standard practice in applying model checking to an
  unbounded-parameter system.
