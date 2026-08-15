# Testing Strategy

## Layers

| Layer | Location | Runs against | Command |
|---|---|---|---|
| Unit (shared) | `packages/shared/src/**/*.test.ts` | nothing external | `pnpm --filter @payment-platform/shared test` |
| Unit (backend) | `packages/backend/src/**/*.test.ts` | mocked Prisma/gateway | `pnpm --filter @payment-platform/backend test` |
| Property-based | `payment.state-machine.pbt.test.ts` | in-memory fake DB | included in the unit run above |
| Integration | `*.integration.test.ts` | **real** Postgres via `supertest` | `pnpm --filter @payment-platform/backend test:integration` |

`test` and `test:integration` are separate npm scripts specifically so the fast, DB-free unit suite can run without any infrastructure, while integration tests require `docker compose up -d postgres` + migrate + seed first.

## What Each Suite Covers

- **`crypto.utils.test.ts` / `validation.utils.test.ts`** (shared): HMAC sign/verify + tamper detection, AES-256-GCM round-trip, Luhn algorithm against known-good/known-bad card numbers, card-brand detection, expiry/CVV validation.
- **`auth.service.test.ts`, `auth.middleware.test.ts`, `authorization.middleware.test.ts`**: register/login flows, token verification edge cases (expired/forged), permission/role/merchant-access allow-deny paths.
- **`payment.service.test.ts`**: idempotency replay/conflict, card validation ordering, capture/refund state-guard errors — all against a mocked Prisma client using `jest.mock`.
- **`payment.state-machine.pbt.test.ts`**: `fast-check`-driven property tests. Generates random operation sequences and asserts three invariants hold across 50 runs each: no invalid status transition, refund sum never exceeds the captured amount, and the idempotency safety/liveness properties hold under simulated concurrency for each strategy.
- **`payment.routes.integration.test.ts`**: full HTTP authorize→capture→refund flow against real Postgres, idempotency replay/conflict over the wire, permission-denial (403), unauthenticated (401).
- **`security.adversarial.integration.test.ts`**: expired/forged JWT, tampered HMAC signature, cross-merchant access denial, log-redaction verification against the real logger config.

## Property-Based Testing Pattern

Unlike the rest of the suite's one-shot `jest.mock(...)` + `mockResolvedValueOnce(...)` style, the property-based tests use a small **in-memory fake Prisma store** (`payment.state-machine.pbt.test.ts`) so a single test run can replay arbitrary-length random operation sequences against consistent state — something a chain of one-off mocks can't express. This is a deliberate, documented deviation from the rest of the codebase's mocking convention.

## Reproducing a Failure

If a property-based test fails, `fast-check` prints a shrunk counterexample and a `seed` — rerun with `fc.assert(..., { seed: <printed seed>, path: <printed path> })` temporarily added to reproduce the exact failing case deterministically.

## CI

`.github/workflows/ci.yml` runs, on every push/PR: install → Prisma generate → migrate → lint → type-check → shared tests → backend unit tests → backend integration tests (against a Postgres service container) → build.

## Adding a New Test

- Mocked unit test for a service: follow `payment.service.test.ts`'s pattern (`jest.mock('./database.service', ...)` etc.).
- HTTP-level integration test: follow `payment.routes.integration.test.ts`'s pattern (`supertest(createApp())`, log in via seeded credentials).
- New idempotency strategy: add its `describe.each` case in `payment.state-machine.pbt.test.ts`'s concurrency block.
