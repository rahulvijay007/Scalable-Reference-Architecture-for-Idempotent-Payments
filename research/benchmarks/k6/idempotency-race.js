import http from 'k6/http';
import { check } from 'k6';

/**
 * Fires CONCURRENCY genuinely-parallel requests sharing a single
 * idempotencyKey (or, in MODE=conflict, sharing the key but with a
 * different amount each) against a backend started with a specific
 * IDEMPOTENCY_STRATEGY. Correctness (exactly one Payment row created) is
 * verified afterward by verify-idempotency.ts directly against the
 * database - k6 itself only measures the HTTP-level outcomes.
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3001 --env STRATEGY=naive \
 *          --env CONCURRENCY=20 --env MODE=identical \
 *          --env IDEMPOTENCY_KEY=<uuid> idempotency-race.js
 *
 * IDEMPOTENCY_KEY must be supplied by the orchestrator (run-all.ts) so it
 * can pass the same key to the verification step afterward.
 */
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const STRATEGY = __ENV.STRATEGY || 'unknown';
const CONCURRENCY = parseInt(__ENV.CONCURRENCY || '10', 10);
const MODE = __ENV.MODE || 'identical'; // 'identical' | 'conflict'
const IDEMPOTENCY_KEY = __ENV.IDEMPOTENCY_KEY;

if (!IDEMPOTENCY_KEY) {
  throw new Error('IDEMPOTENCY_KEY env var is required (supplied by run-all.ts)');
}

export const options = {
  scenarios: {
    race: {
      executor: 'per-vu-iterations',
      vus: CONCURRENCY,
      iterations: 1,
      maxDuration: '30s',
    },
  },
};

const VALID_CARD = {
  cardNumber: '4111111111111111',
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 2,
  cvv: '123',
  cardholderName: 'k6 Race Test',
};

export function setup() {
  // See throughput-latency.js's setup() for why credentials are reused
  // rather than logging in fresh when the orchestrator supplies them.
  if (__ENV.ACCESS_TOKEN && __ENV.MERCHANT_ID) {
    return { accessToken: __ENV.ACCESS_TOKEN, merchantId: __ENV.MERCHANT_ID };
  }

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'merchant@payment-platform.com', password: 'Merchant@123456' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Setup login failed: ${loginRes.status} ${loginRes.body}`);
  }

  const body = JSON.parse(loginRes.body);
  return { accessToken: body.data.accessToken, merchantId: body.data.user.merchantId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.accessToken}`,
  };

  // In 'conflict' mode every VU sends a different amount under the same
  // key, so at most one can "win" and every other response must be a 409,
  // never a second 201 with a different amount.
  const amount = MODE === 'conflict' ? 10 + __VU : 10;

  const res = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({
      merchantId: data.merchantId,
      amount,
      currency: 'USD',
      paymentMethod: 'CREDIT_CARD',
      cardDetails: VALID_CARD,
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    { headers, tags: { vu: String(__VU) } }
  );

  check(res, {
    'response is a definitive outcome (201, 200, 409, or 423) - not a 5xx crash': (r) =>
      [200, 201, 409, 423].includes(r.status),
  });
}

export function handleSummary(data) {
  const statusCounts = {};
  // k6's http_req_duration doesn't expose per-request status easily in
  // handleSummary without a custom metric per status; instead we rely on
  // the check() outcome above plus verify-idempotency.ts for the ground
  // truth (actual row count), and record aggregate check pass/fail counts
  // here as a secondary signal.
  const checksTotal = data.metrics.checks ? data.metrics.checks.values : null;

  const summary = {
    strategy: STRATEGY,
    concurrency: CONCURRENCY,
    mode: MODE,
    idempotencyKey: IDEMPOTENCY_KEY,
    timestamp: new Date().toISOString(),
    checks: checksTotal,
    http_req_duration: data.metrics.http_req_duration ? data.metrics.http_req_duration.values : null,
    statusCounts,
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    [`../../results/idempotency-race-${STRATEGY}-${MODE}-${CONCURRENCY}.json`]: JSON.stringify(summary, null, 2),
  };
}
