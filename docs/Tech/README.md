# Technical Documentation

Reference documentation for engineers working on or evaluating this codebase.

1. [Architecture Overview](01-architecture-overview.md) — monorepo structure, request flow, layering
2. [API Reference](02-api-reference.md) — every endpoint, auth model, error codes
3. [Database Schema](03-database-schema.md) — entities, relationships, migrations
4. [Security Architecture](04-security-architecture.md) — auth, RBAC, HMAC, card-data handling, known gaps
5. [Idempotency Protocol](05-idempotency-protocol.md) — the project's core technical contribution
6. [Testing Strategy](06-testing-strategy.md) — unit, property-based, integration, CI
7. [Observability](07-observability.md) — metrics, logging, health checks, dashboards
8. [Local Development Setup](08-local-development-setup.md) — get running in five commands
9. [Deployment & CI](09-deployment-and-ci.md) — CI pipeline, container image, production config

For the deeper research artifact (formal correctness arguments, threat model, benchmark methodology and raw results, bibliography), see [`research/`](../../research) at the repo root — these docs summarize and link into it rather than duplicating it.
