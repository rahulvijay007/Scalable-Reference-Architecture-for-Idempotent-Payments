# Related Work

Compiled via web research. **Hard constraint applied: every entry below was published (or last substantively revised, for living standards documents) in 2022 or later.** Pre-2022 foundational sources that came up during research (e.g., Kleppmann's original 2016 Redlock critique, Stripe's original 2017 idempotency blog post) were deliberately excluded per this constraint, even where they are the historically "canonical" reference — see the note in §4.

## 1. Industry idempotency engineering

**IETF, "The Idempotency-Key HTTP Header Field" (draft-ietf-httpapi-idempotency-key-header)**
Internet-Draft, httpapi working group. First tracked revision -00 and -01 dated May 2022; actively revised through -07.
https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header
*Relevance*: standardizes exactly the mechanism this project implements as `idempotencyKey` — a client-generated, server-scoped key that "MUST NOT be reused with another request with a different request payload," which is precisely the conflict condition `payment.service.ts`'s `hashIdempotentRequest`/`reconcile` logic detects and rejects with `409 IDEMPOTENCY_KEY_CONFLICT`. Cited to show the request-hash-conflict design matches emerging standards-track guidance, not just Stripe's proprietary convention.

**AWS, "Idempotency" utility — Powertools for AWS Lambda**
Official AWS documentation, actively maintained (TypeScript v2.x current through 2024; Python/Java equivalents maintained in parallel).
https://docs.aws.amazon.com/powertools/typescript/2.1.1/utilities/idempotency/
*Relevance*: an industry reference implementation of idempotent request handling using a persistence layer (DynamoDB) to store request/response state keyed by a hashed subset of the payload — structurally analogous to this project's `Payment.idempotencyKey` + `metadata._requestHash` approach, but using an external key-value store rather than the primary relational table. Useful as a comparison point for the "where does idempotency state live" design decision.

**"Idempotency and Reconciliation in Payment Software"**, International Journal for Research in Applied Science & Engineering Technology (IJRASET), 2024.
https://doi.org/10.22214/ijraset.2024.60774
*Relevance*: a practitioner-oriented treatment of idempotency specifically in payment systems (citing real-world patterns like Visa's use of UUID-based transaction identifiers), corroborating that idempotency-key-based deduplication is the dominant industry pattern this project's protocol formalizes and empirically validates.

## 2. Security baseline

**OWASP API Security Top 10 (2023 edition)**
https://owasp.org/API-Security/editions/2023/en/0x00-header/
*Relevance*: canonical reference for `research/security/threat-model.md`'s threat categories. Directly maps onto this project's mitigations: API1:2023 Broken Object Level Authorization ↔ `assertMerchantAccess()`/`requireMerchantAccess()`; API2:2023 Broken Authentication ↔ JWT/API-key middleware; API4:2023 Unrestricted Resource Consumption ↔ rate-limiting middleware; API8:2023 Security Misconfiguration ↔ Helmet/CORS/HMAC-opt-in configuration.

## 3. Microservice architecture & security (academic)

**Zdun, U., Queval, P.-J., Simhandl, G., Scandariato, R., Chakravarty, S., Jelic, M., & Jovanovic, A. (2023).** "Microservice Security Metrics for Secure Communication, Identity Management, and Observability." *ACM Transactions on Software Engineering and Methodology*, 32(1).
https://doi.org/10.1145/3532183
*Relevance*: proposes metrics for exactly the three pillars this project's paper title claims — security, and (via a shared "observability" tactic category) the monitoring dimension. Useful as a related-but-distinct contribution: Zdun et al. measure architectural conformance to security tactics across many systems; this project instead does a deep, single-system empirical validation (property-based tests + concurrency benchmarks) of one specific mechanism (idempotent authorization).

**Billawa, P., Bambhore Tukaram, A., Díaz Ferreyra, N., Steghöfer, J.-P., Scandariato, R., & Simhandl, G. (2022).** "Towards a Security Benchmark for the Architectural Design of Microservice Applications." *Proceedings of the 17th International Conference on Availability, Reliability and Security (ARES 2022)*.
https://doi.org/10.1145/3538969.3543807
*Relevance*: proposes a benchmark for microservice security design decisions; cited to position this project's threat-model-plus-adversarial-test approach (§3 of the artifact) as a concrete instance of the kind of architectural security validation this line of work argues for.

**"Microservices Security: Bad vs. Good Practices."** *Software Architecture. ECSA 2022 Tracks and Workshops*, Springer.
https://doi.org/10.1007/978-3-031-36889-9_23
*Relevance*: a multivocal literature review of microservice security practices; used to cross-check that this project's specific choices (defense-in-depth RBAC at both middleware and service layer, card-data minimization, structured log redaction) align with practices the literature independently identifies as "good," rather than being ad hoc.

## 4. Distributed locking (Redis-lock strategy comparison)

No source meeting the 2022+ constraint was found that supersedes or substantively revises the original Redlock safety debate (Kleppmann's 2016 critique and Redis's contemporaneous response). Redis's own current distributed-locking documentation (redis.io) is continuously revised but not attributably dated to a specific 2022+ publication event, so it is not cited as a dated source here. Per the plan for this artifact, this gap is intentionally **not** papered over with a citation that doesn't meet the recency bar - the liveness caveat for the `redis-lock` strategy (TTL-vs-critical-section-duration risk, no fencing tokens) in `research/formal-model/idempotency-protocol.md` §4 is instead argued informally, from first principles, exactly as that document states.

## 5. How this project extends the above

None of the sources above combine (a) a concurrency-safe idempotency protocol with an explicit safety/liveness argument, (b) property-based testing of that protocol under simulated concurrency, and (c) a three-way empirical comparison (naive/optimistic/distributed-lock) with real database-level correctness verification. The IETF draft standardizes *what* an idempotency key is; the AWS/industry sources show *an* implementation pattern; the microservice-security papers address security architecture at a coarser grain. This project's contribution is the formal-plus-empirical treatment of the specific mechanism, including a defect (the naive protocol's unhandled `P2002` crash, and the pending-transaction race caught during property-based testing) that none of the surveyed industry documentation calls out explicitly.
