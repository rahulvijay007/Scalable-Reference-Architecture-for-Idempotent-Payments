import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

/**
 * Throughput/latency benchmark for the authorize -> capture -> refund
 * lifecycle, at increasing concurrency. Run against a backend started with
 * a specific IDEMPOTENCY_STRATEGY (see research/benchmarks/run-all.ts).
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3001 --env STRATEGY=optimistic \
 *          --env VUS=10 --env DURATION=30s throughput-latency.js
 */
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const STRATEGY = __ENV.STRATEGY || 'unknown';
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '20s';

// The CreatePaymentSchema route validator requires idempotencyKey to be a
// well-formed UUID (express-validator's .isUUID()) - a plain concatenated
// string like `${__VU}-${__ITER}-...` fails that check with a 400, which
// silently zeroed out every capture/refund measurement below until this was
// caught. k6's sandboxed runtime has no crypto.randomUUID(), so this is a
// minimal Math.random()-based UUIDv4 generator (fine for benchmark traffic,
// not for anything security-sensitive).
function randomUUIDv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const authorizeLatency = new Trend('authorize_latency_ms');
const captureLatency = new Trend('capture_latency_ms');
const refundLatency = new Trend('refund_latency_ms');
const lifecycleErrors = new Counter('lifecycle_errors');

export const options = {
  scenarios: {
    lifecycle: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    lifecycle_errors: ['count==0'],
  },
};

const VALID_CARD = {
  cardNumber: '4111111111111111',
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 2,
  cvv: '123',
  cardholderName: 'k6 Load Test',
};

export function setup() {
  // Reuse credentials passed by the orchestrator (run-all-benchmarks.ts) if
  // available, so a full benchmark run only logs in once per strategy
  // rather than once per k6 script invocation - the auth endpoint's rate
  // limiter (5 attempts/15min) would otherwise be tripped partway through a
  // single strategy's run. Falls back to a fresh login for standalone use.
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

  const idempotencyKey = randomUUIDv4();

  const authorizeStart = Date.now();
  const createRes = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({
      merchantId: data.merchantId,
      amount: 25,
      currency: 'USD',
      paymentMethod: 'CREDIT_CARD',
      cardDetails: VALID_CARD,
      idempotencyKey,
    }),
    { headers }
  );
  authorizeLatency.add(Date.now() - authorizeStart);

  const authorizeOk = check(createRes, { 'authorize succeeded': (r) => r.status === 201 });
  if (!authorizeOk) {
    lifecycleErrors.add(1);
    return;
  }

  const paymentId = JSON.parse(createRes.body).data.id;

  const captureStart = Date.now();
  const captureRes = http.post(`${BASE_URL}/api/payments/${paymentId}/capture`, JSON.stringify({}), { headers });
  captureLatency.add(Date.now() - captureStart);

  const captureOk = check(captureRes, { 'capture succeeded': (r) => r.status === 200 });
  if (!captureOk) {
    lifecycleErrors.add(1);
    return;
  }

  const refundStart = Date.now();
  const refundRes = http.post(
    `${BASE_URL}/api/payments/${paymentId}/refund`,
    JSON.stringify({ amount: 25 }),
    { headers }
  );
  refundLatency.add(Date.now() - refundStart);

  check(refundRes, { 'refund succeeded': (r) => r.status === 200 }) || lifecycleErrors.add(1);
}

export function handleSummary(data) {
  const summary = {
    strategy: STRATEGY,
    vus: VUS,
    duration: DURATION,
    timestamp: new Date().toISOString(),
    metrics: {
      authorize_latency_ms: data.metrics.authorize_latency_ms ? data.metrics.authorize_latency_ms.values : null,
      capture_latency_ms: data.metrics.capture_latency_ms ? data.metrics.capture_latency_ms.values : null,
      refund_latency_ms: data.metrics.refund_latency_ms ? data.metrics.refund_latency_ms.values : null,
      http_req_duration: data.metrics.http_req_duration ? data.metrics.http_req_duration.values : null,
      http_reqs: data.metrics.http_reqs ? data.metrics.http_reqs.values : null,
      lifecycle_errors: data.metrics.lifecycle_errors ? data.metrics.lifecycle_errors.values : null,
      iterations: data.metrics.iterations ? data.metrics.iterations.values : null,
    },
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    [`../../results/throughput-latency-${STRATEGY}-${VUS}vus.json`]: JSON.stringify(summary, null, 2),
  };
}
