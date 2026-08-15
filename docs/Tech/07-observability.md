# Observability

## Metrics

`GET /metrics` (Prometheus text format, no auth, outside the rate-limited `/api` mount). Defined in `packages/backend/src/middleware/metrics.middleware.ts`:

- `http_request_duration_seconds` — Histogram, labels `method`/`route`/`status_code`, buckets `[0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]`
- `payment_operations_total` — Counter, labels `operation` (`authorize|capture|refund|cancel`) / `status` (`success|failure`)
- Default Node.js process metrics (`collectDefaultMetrics()`)

Prometheus scrape config: `infrastructure/prometheus/prometheus.yml`, job `payment-api` targeting `host.docker.internal:3001`.

## Logging

Pino, structured JSON in production, pretty-printed in development (`packages/backend/src/utils/logger.ts`). Request-level logging via `request-logger.middleware.ts` (method, path, status, duration, IP, user-agent on every response). Card data and auth headers are redacted (`LOG_REDACT_CONFIG`) — see `04-security-architecture.md`.

## Health Checks

- `GET /health` — real connectivity checks against Postgres, Redis, and RabbitMQ (`Promise.allSettled`), returns `healthy`/`degraded`/`unhealthy` with per-service status.
- `GET /ready` — Kubernetes readiness; fails (503) if the database is unreachable.
- `GET /live` — Kubernetes liveness; always 200 if the process is responding.

## Grafana Dashboard

`infrastructure/grafana/dashboards/payment-platform.json`, auto-provisioned (mounted via `docker-compose.yml`'s Grafana volume). Panels:
1. Request latency p50/p95/p99 by route
2. Payment operation success vs. failure rate by operation
3. Overall payment failure ratio (with warning/critical thresholds)
4. HTTP requests/sec by route and status code

Access: `http://localhost:3002` (admin/admin) → "Payment Platform" dashboard.

## Fault-Injection Demonstration

`packages/backend/scripts/fault-injection.ts` starts the backend with a deliberately degraded `MOCK_GATEWAY_SUCCESS_RATE`, runs a k6 load burst, then queries Prometheus's HTTP API directly for the same PromQL the dashboard uses — producing a JSON artifact proving the pipeline actually detects an induced degradation end-to-end (not just "the dashboard exists").

```bash
docker compose up -d postgres prometheus grafana
cd packages/backend
pnpm bench:fault-injection -- --duration=90 --success-rate=0.3
```

A real run showed the failure-ratio metric climb to ~70-71% against an injected 30% gateway success rate (i.e., roughly matching the expected ~70% per-operation failure rate) — output archived in `research/results/observability/`.

## What's *Not* Wired Up

- Elasticsearch/Logstash/Kibana are defined in `docker-compose.yml` but the app currently logs to stdout only (Pino), not shipped to Elasticsearch — Logstash's pipeline config exists but has no active log source pointed at it.
- No alerting rules configured in Prometheus/Grafana (dashboards only).
