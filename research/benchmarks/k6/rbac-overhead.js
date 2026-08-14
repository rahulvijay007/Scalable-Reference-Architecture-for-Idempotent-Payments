import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Microbenchmark isolating auth/RBAC middleware cost from downstream work:
 *   1. baseline    - GET /api/__not-a-real-route (404; raw Express+network overhead)
 *   2. auth-only   - GET /api/auth/me (authenticate middleware only, no permission check)
 *   3. auth+rbac   - GET /api/_bench/rbac-check (authenticate + requirePermission, no DB call)
 *
 * Caveat (documented, not hidden): (2) and (3) aren't perfectly isolated
 * from each other's own JWT-verification cost, since requirePermission
 * necessarily runs after authenticate in the middleware chain - the (3)-(2)
 * delta is the closest available estimate of requirePermission's own cost
 * in isolation.
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3001 --env VUS=20 --env DURATION=15s rbac-overhead.js
 */
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const VUS = parseInt(__ENV.VUS || '20', 10);
const DURATION = __ENV.DURATION || '15s';

const baselineLatency = new Trend('baseline_latency_ms');
const authOnlyLatency = new Trend('auth_only_latency_ms');
const authRbacLatency = new Trend('auth_rbac_latency_ms');

export const options = {
  scenarios: {
    rbac_overhead: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
};

export function setup() {
  // See throughput-latency.js's setup() for why credentials are reused
  // rather than logging in fresh when the orchestrator supplies them.
  if (__ENV.ACCESS_TOKEN) {
    return { accessToken: __ENV.ACCESS_TOKEN };
  }

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: 'merchant@payment-platform.com', password: 'Merchant@123456' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Setup login failed: ${loginRes.status} ${loginRes.body}`);
  }

  return { accessToken: JSON.parse(loginRes.body).data.accessToken };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.accessToken}` };

  const t0 = Date.now();
  const baselineRes = http.get(`${BASE_URL}/api/__not-a-real-route`);
  baselineLatency.add(Date.now() - t0);
  check(baselineRes, { 'baseline is 404': (r) => r.status === 404 });

  const t1 = Date.now();
  const authRes = http.get(`${BASE_URL}/api/auth/me`, { headers });
  authOnlyLatency.add(Date.now() - t1);
  check(authRes, { 'auth-only succeeds': (r) => r.status === 200 });

  const t2 = Date.now();
  const rbacRes = http.get(`${BASE_URL}/api/_bench/rbac-check`, { headers });
  authRbacLatency.add(Date.now() - t2);
  check(rbacRes, { 'auth+rbac succeeds': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const summary = {
    vus: VUS,
    duration: DURATION,
    timestamp: new Date().toISOString(),
    baseline_latency_ms: data.metrics.baseline_latency_ms ? data.metrics.baseline_latency_ms.values : null,
    auth_only_latency_ms: data.metrics.auth_only_latency_ms ? data.metrics.auth_only_latency_ms.values : null,
    auth_rbac_latency_ms: data.metrics.auth_rbac_latency_ms ? data.metrics.auth_rbac_latency_ms.values : null,
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    [`../../results/rbac-overhead-${VUS}vus.json`]: JSON.stringify(summary, null, 2),
  };
}
