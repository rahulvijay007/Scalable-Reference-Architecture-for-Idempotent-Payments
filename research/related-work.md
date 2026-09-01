# Related Work

Compiled via web research. **Hard constraint applied: every entry below was published (or last substantively revised, for living standards documents) in 2022 or later.** Pre-2022 foundational sources that came up during research (e.g., Kleppmann's original 2016 Redlock critique, Stripe's original 2017 idempotency blog post) were deliberately excluded per this constraint, even where they are the historically "canonical" reference — see the note in §4.

## 1. Industry idempotency engineering

**IETF, "The Idempotency-Key HTTP Header Field" (draft-ietf-httpapi-idempotency-key-header)**
Internet-Draft, httpapi working group. First tracked revision -00 and -01 dated May 2022; actively revised through -07.
https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header
_Relevance_: standardizes exactly the mechanism this project implements as `idempotencyKey` — a client-generated, server-scoped key that "MUST NOT be reused with another request with a different request payload," which is precisely the conflict condition `payment.service.ts`'s `hashIdempotentRequest`/`reconcile` logic detects and rejects with `409 IDEMPOTENCY_KEY_CONFLICT`. Cited to show the request-hash-conflict design matches emerging standards-track guidance, not just Stripe's proprietary convention.

**AWS, "Idempotency" utility — Powertools for AWS Lambda**
Official AWS documentation, actively maintained (TypeScript v2.x current through 2024; Python/Java equivalents maintained in parallel).
https://docs.aws.amazon.com/powertools/typescript/2.1.1/utilities/idempotency/
_Relevance_: an industry reference implementation of idempotent request handling using a persistence layer (DynamoDB) to store request/response state keyed by a hashed subset of the payload — structurally analogous to this project's `Payment.idempotencyKey` + `metadata._requestHash` approach, but using an external key-value store rather than the primary relational table. Useful as a comparison point for the "where does idempotency state live" design decision.

**"Idempotency and Reconciliation in Payment Software"**, International Journal for Research in Applied Science & Engineering Technology (IJRASET), 2024.
https://doi.org/10.22214/ijraset.2024.60774
_Relevance_: a practitioner-oriented treatment of idempotency specifically in payment systems (citing real-world patterns like Visa's use of UUID-based transaction identifiers), corroborating that idempotency-key-based deduplication is the dominant industry pattern this project's protocol formalizes and empirically validates.

## 2. Security baseline

**OWASP API Security Top 10 (2023 edition)**
https://owasp.org/API-Security/editions/2023/en/0x00-header/
_Relevance_: canonical reference for `research/security/threat-model.md`'s threat categories. Directly maps onto this project's mitigations: API1:2023 Broken Object Level Authorization ↔ `assertMerchantAccess()`/`requireMerchantAccess()`; API2:2023 Broken Authentication ↔ JWT/API-key middleware; API4:2023 Unrestricted Resource Consumption ↔ rate-limiting middleware; API8:2023 Security Misconfiguration ↔ Helmet/CORS/HMAC-opt-in configuration.

## 3. Microservice architecture & security (academic)

**Zdun, U., Queval, P.-J., Simhandl, G., Scandariato, R., Chakravarty, S., Jelic, M., & Jovanovic, A. (2023).** "Microservice Security Metrics for Secure Communication, Identity Management, and Observability." _ACM Transactions on Software Engineering and Methodology_, 32(1).
https://doi.org/10.1145/3532183
_Relevance_: proposes metrics for exactly the three pillars this project's paper title claims — security, and (via a shared "observability" tactic category) the monitoring dimension. Useful as a related-but-distinct contribution: Zdun et al. measure architectural conformance to security tactics across many systems; this project instead does a deep, single-system empirical validation (property-based tests + concurrency benchmarks) of one specific mechanism (idempotent authorization).

**Billawa, P., Bambhore Tukaram, A., Díaz Ferreyra, N., Steghöfer, J.-P., Scandariato, R., & Simhandl, G. (2022).** "Towards a Security Benchmark for the Architectural Design of Microservice Applications." _Proceedings of the 17th International Conference on Availability, Reliability and Security (ARES 2022)_.
https://doi.org/10.1145/3538969.3543807
_Relevance_: proposes a benchmark for microservice security design decisions; cited to position this project's threat-model-plus-adversarial-test approach (§3 of the artifact) as a concrete instance of the kind of architectural security validation this line of work argues for.

**"Microservices Security: Bad vs. Good Practices."** _Software Architecture. ECSA 2022 Tracks and Workshops_, Springer.
https://doi.org/10.1007/978-3-031-36889-9_23
_Relevance_: a multivocal literature review of microservice security practices; used to cross-check that this project's specific choices (defense-in-depth RBAC at both middleware and service layer, card-data minimization, structured log redaction) align with practices the literature independently identifies as "good," rather than being ad hoc.

## 4. Distributed locking (Redis-lock strategy comparison)

No source meeting the 2022+ constraint was found that supersedes or substantively revises the original Redlock safety debate (Kleppmann's 2016 critique and Redis's contemporaneous response). Redis's own current distributed-locking documentation (redis.io) is continuously revised but not attributably dated to a specific 2022+ publication event, so it is not cited as a dated source here. Per the plan for this artifact, this gap is intentionally **not** papered over with a citation that doesn't meet the recency bar - the liveness caveat for the `redis-lock` strategy (TTL-vs-critical-section-duration risk, no fencing tokens) in `research/formal-model/idempotency-protocol.md` §4 is instead argued informally, from first principles, exactly as that document states.

## 5. Distributed transactions & the Saga pattern (alternative to idempotency-key deduplication)

**Koyya, K. M., & Muthukumar, B. (2022).** "A Survey of Saga Frameworks for Distributed Transactions in Event-driven Microservices." _2022 Third International Conference on Smart Technologies in Computing, Electrical and Electronics (ICSTCEE)_.
https://ieeexplore.ieee.org/iel7/10099469/10099487/10099533.pdf
_Relevance_: surveys the Saga pattern — the dominant _alternative_ approach to distributed-transaction correctness in event-driven microservices, as opposed to this project's single-service idempotency-key approach. Cited to position the scope boundary explicitly: this project's protocol guarantees correctness for one service's request-level deduplication, not cross-service compensating-transaction orchestration, which is Saga's problem domain.

**Daraghmi, E., Zhang, C.-P., & Yuan, S.-M. (2022).** "Enhancing Saga Pattern for Distributed Transactions within a Microservices Architecture." _Applied Sciences_, 12(12), 6242.
https://doi.org/10.3390/app12126242
_Relevance_: identifies and fixes a specific correctness gap in the standard Saga pattern (lack of isolation, via a quota-cache/commit-sync mechanism) — methodologically the same move this project makes for the idempotency protocol (finding and fixing a specific race the "standard" approach doesn't handle), just for a different mechanism. Useful as a structural parallel when framing this paper's contribution.

## 6. Formal and semi-formal methods in industrial practice (context for this project's TLA+ model)

**"Systems Correctness Practices at AWS: Leveraging Formal and Semi-formal Methods."** _ACM Queue_, 22(6) (2024).
https://doi.org/10.1145/3712057
_Relevance_: documents how AWS combines TLA+/model checking with property-based testing, fault-injection testing, and deterministic simulation across services like S3, DynamoDB, and EBS — the same combination of techniques (formal model + property-based tests + fault injection) this project applies to a single mechanism at a much smaller scale. Cited to show `research/formal-model/formal-proof.md`'s three-independent-lines-of-evidence approach mirrors documented industrial practice, not an ad hoc combination.

## 7. Property-based testing methodology (context for `payment.state-machine.pbt.test.ts`)

**Goldstein, H., Cutler, J. W., Dickstein, D., Pierce, B. C., & Head, A. (2024).** "Property-Based Testing in Practice." _Proceedings of the IEEE/ACM 46th International Conference on Software Engineering (ICSE '24)_, 1–13.
https://doi.org/10.1145/3597503.3639581
_Relevance_: an empirical study of how property-based testing is actually used in industrial practice (including at Amazon and Stripe — the latter a payments company). Cited to support the methodological choice of `fast-check`-based property testing in this project as an evidence-backed technique for concurrency-bug discovery, not just a convenient library — and specifically corroborates that "harder to specify meaningful properties than to write example tests" (a challenge this project addresses concretely via the safety/liveness properties in `formal-proof.md`) is a known, documented friction point in the field.

## 8. Chaos engineering & fault injection (context for `fault-injection.ts` / `fault-injection-lock-expiry.ts`)

**"Chaos Engineering: A Multi-Vocal Literature Review."** arXiv:2412.01416 (2024).
https://arxiv.org/pdf/2412.01416
_Relevance_: surveys chaos-engineering/fault-injection practice across 50 academic and industry sources. Cited to position this project's two fault-injection scripts — one demonstrating gateway-failure resilience via Prometheus/Grafana (`research/results/observability/`), one specifically reproducing the Redis-lock TTL-expiry weakness (`research/results/README.md`) — as instances of a recognized methodology (deliberately injecting a specific fault to empirically validate a specific resilience or correctness claim) rather than ad hoc stress testing.

## 9. API authentication security (context for the JWT + HMAC threat model)

**Xu, B., Jia, S., Lin, J., Zheng, F., Ma, Y., Liu, L., Gu, X., & Song, L. (2023).** "JWTKey: Automatic Cryptographic Vulnerability Detection in JWT Applications." _Computer Security – ESORICS 2023_, LNCS vol. 14346, Springer.
https://doi.org/10.1007/978-3-031-51479-1_14
_Relevance_: found cryptographic vulnerabilities in 65.9% of 358 real-world open-source JWT applications surveyed — direct empirical evidence that JWT misconfiguration is a common, not theoretical, class of defect. Cited in `research/security/threat-model.md`'s JWT-handling section to justify why this project's specific choices (short-lived 15-minute access tokens, explicit algorithm pinning, and the optional HMAC request-signing layer on top of bearer auth) are defensive responses to a documented, prevalent vulnerability class rather than precautions against a hypothetical.

## 10. Fintech risk landscape (broader framing for the payments domain)

**Jain, R., Kumar, S., Sood, K., Grima, S., & Rupeika-Apoga, R. (2023).** "A Systematic Literature Review of the Risk Landscape in Fintech." _Risks_, 11(2), 36.
https://doi.org/10.3390/risks11020036
_Relevance_: a Scopus-sourced bibliometric review of 84 articles on fintech risk, identifying rising cybercrime risk alongside fintech's reduction in physical-crime risk. Cited in the paper's introduction/motivation section to establish the broader domain stakes (why payment-system correctness and security research matters) with a citation to the aggregate academic risk literature, rather than asserting the premise unsupported.

## 11. How this project extends the above

None of the sources above combine (a) a concurrency-safe idempotency protocol with an explicit safety/liveness argument, (b) a machine-checked formal model of that argument (§6's AWS parallel notwithstanding — AWS's published material describes the _practice_ of combining TLA+ with testing, not a worked example at this mechanism's granularity), (c) property-based testing of the same protocol under simulated concurrency, and (d) a four-way empirical comparison (naive/optimistic/distributed-lock, plus the distributed-lock's own TTL-expiry failure mode reproduced under fault injection) with real database-level correctness verification. The IETF draft standardizes _what_ an idempotency key is; the AWS/industry sources show _an_ implementation pattern and, separately, _a_ verification methodology; the Saga literature addresses a different (cross-service) point in the same design space; the microservice-security papers address security architecture at a coarser grain. This project's contribution is the formal-plus-machine-checked-plus-empirical treatment of one specific mechanism end to end, including defects at three different layers that none of the surveyed sources call out for this mechanism specifically: the naive protocol's unhandled `P2002` crash (§2), the pending-transaction race caught during property-based testing (`idempotency-protocol.md` §6), and the Redis-lock strategy's TTL-expiry liveness failure, which this project is (to the best of this research pass's knowledge) the only source here to reproduce as a quantified, repeated-trial experiment rather than state as a theoretical caveat.

### A qualitative baseline: how this compares to Stripe's public idempotency behavior

**Stripe, "Idempotent requests" (API reference, live/continuously-revised documentation, accessed 2026).**
https://docs.stripe.com/api/idempotent_requests

Stripe's API is the most widely cited real-world reference implementation of idempotency keys (indeed, the IETF draft in §1 credits it as prior art). Stripe's documentation states two behaviors directly relevant here, quoted rather than paraphrased since precision matters for this comparison: (1) "the idempotency layer compares incoming parameters to those of the original request and errors if they're not the same" — mirroring this project's `409 IDEMPOTENCY_KEY_CONFLICT` for the conflicting-payload case exactly; and (2) "if... the request conflicts with another request that's executing concurrently, we don't save the idempotent result because no API endpoint initiates the execution. You can retry these requests" — i.e., for the _identical_-payload concurrent-duplicate case, Stripe's documented behavior is an immediate, well-defined error response instructing the client to retry, not a crash and not a silent hang. Stripe does not publish the internal mechanism producing this behavior, so no mechanism-level comparison against this project's three strategies is possible from public information alone — but the documented _outcome_ (every concurrent caller gets a well-defined result, none get an unhandled error) is exactly this project's Liveness property, achieved by a different means (an explicit retry-instruction response) than any of this project's three strategies (none of which surface a "retry me" response — the loser is either reconciled against the winner directly, in `optimistic`/`redis-lock`, or crashes, in `naive`). This project's `optimistic` strategy in fact goes one step further than Stripe's documented behavior: it resolves the losing concurrent caller to a definitive result (the winner's payment) directly, without requiring that caller to retry at all.
