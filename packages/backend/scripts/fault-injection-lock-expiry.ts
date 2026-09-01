/**
 * Empirically demonstrates the Redis-lock strategy's documented liveness
 * weakness (research/formal-model/idempotency-protocol.md §4, point 2):
 * if the critical section legitimately outlives IDEMPOTENCY_LOCK_TTL_MS,
 * the lock expires while still logically "in use," a second concurrent
 * caller acquires it, and both callers can reach the database's INSERT
 * concurrently - reopening the exact race the lock exists to prevent, this
 * time inside RedisLockStrategy.run(), which does NOT catch the resulting
 * P2002 unique-constraint violation (only the naive strategy's absence of
 * a catch was previously demonstrated; this shows the lock strategy
 * degrades to the same failure mode under the specific condition its own
 * docstring already warns about).
 *
 * This was previously a documented-but-unmeasured limitation. This script
 * turns it into a quantified, reproducible empirical result by running two
 * conditions at the SAME concurrency:
 *
 *   condition A ("vulnerable"): IDEMPOTENCY_LOCK_TTL_MS set shorter than a
 *     synthetic delay (IDEMPOTENCY_DEBUG_CRITICAL_SECTION_DELAY_MS, see
 *     config/index.ts and redis-lock.strategy.ts) injected inside the
 *     lock's own critical section - necessary because the real gateway
 *     call happens AFTER the lock is released (payment.service.ts calls
 *     paymentGateway.authorize() only once idempotencyStrategy.run() has
 *     returned), so MOCK_GATEWAY_LATENCY_MS alone cannot reach this race:
 *     the critical section the lock actually protects is DB-only and
 *     normally fast (a finding worth reporting in its own right - see the
 *     summary this script prints).
 *   condition B ("control"):    IDEMPOTENCY_LOCK_TTL_MS set comfortably
 *     longer than that same synthetic delay (the documented correct
 *     configuration), delay disabled.
 *
 * Usage:
 *   pnpm bench:fault-injection-lock-expiry
 *   pnpm bench:fault-injection-lock-expiry -- --concurrency=10 --latency=1000 --ttl-vulnerable=300 --ttl-control=5000
 */
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

function resolveK6Binary(): string {
  if (process.env.K6_BIN) return process.env.K6_BIN;
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\k6\\k6.exe', 'C:\\Program Files (x86)\\k6\\k6.exe']
      : [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'k6';
}

const K6_BIN = resolveK6Binary();
const BACKEND_DIR = path.resolve(__dirname, '..');
const K6_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'benchmarks', 'k6');
const RESULTS_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'results', 'observability');
const BASE_URL = 'http://localhost:3001';

function argValue(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}

const CONCURRENCY = argValue('concurrency', '10');
const LATENCY_MS = argValue('latency', '1000');
const TTL_VULNERABLE_MS = argValue('ttl-vulnerable', '300');
const TTL_CONTROL_MS = argValue('ttl-control', '5000');
const TRIALS = parseInt(argValue('trials', '5'), 10);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok || res.status === 503) {
        const body = (await res.json()) as { data?: { services?: { database?: string } } };
        if (body.data?.services?.database === 'up') return;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms`);
}

function killProcessTree(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc.pid) return resolve();
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f']);
      resolve();
    } else {
      proc.kill('SIGTERM');
      setTimeout(resolve, 500);
    }
  });
}

function startBackend(lockTtlMs: string, criticalSectionDelayMs: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        IDEMPOTENCY_STRATEGY: 'redis-lock',
        MOCK_GATEWAY_SUCCESS_RATE: '1',
        MOCK_GATEWAY_LATENCY_MS: LATENCY_MS,
        IDEMPOTENCY_LOCK_TTL_MS: lockTtlMs,
        IDEMPOTENCY_DEBUG_CRITICAL_SECTION_DELAY_MS: criticalSectionDelayMs,
        PORT: '3001',
        RATE_LIMIT_MAX_REQUESTS: '1000000',
      },
      stdio: 'pipe',
      shell: true,
    });
    let resolved = false;
    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!resolved && /Server running on port/.test(chunk.toString())) {
        resolved = true;
        resolve(child);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend exited early with code ${code}. Stderr tail:\n${stderrTail}`));
      }
    });
  });
}

async function loginOnce(): Promise<{ accessToken: string; merchantId: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'merchant@payment-platform.com', password: 'Merchant@123456' }),
  });
  if (!res.ok) throw new Error(`Orchestrator login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    data: { accessToken: string; user: { merchantId: string } };
  };
  return { accessToken: body.data.accessToken, merchantId: body.data.user.merchantId };
}

function runK6(envVars: Record<string, string>): void {
  const envArgs = Object.entries(envVars).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  spawnSync(K6_BIN, ['run', ...envArgs, 'idempotency-race.js'], { cwd: K6_DIR, stdio: 'inherit' });
}

function runVerification(idempotencyKey: string): {
  paymentRowCount: number;
  safetyHolds: boolean;
} {
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/verify-idempotency.ts', idempotencyKey],
    {
      cwd: BACKEND_DIR,
      shell: true,
      encoding: 'utf-8',
    }
  );
  const parsed = JSON.parse(result.stdout);
  return { paymentRowCount: parsed.paymentRowCount, safetyHolds: parsed.safetyHolds };
}

// Reads the check pass/fail counts k6's handleSummary() just wrote for this
// (STRATEGY, MODE, CONCURRENCY) combination - this is the LIVENESS signal
// (did any requester get an undefined/5xx outcome), independent of the
// SAFETY signal from runVerification() (did more than one Payment row get
// created). The two can diverge: the DB's UNIQUE constraint can hold
// (safety intact) while a loser still crashes with an unhandled P2002
// (liveness violated) - that divergence is itself the interesting result.
function readLastRaceLiveness(strategyLabel: string): {
  checksPassed: number;
  checksFailed: number;
} {
  const file = path.join(
    RESULTS_DIR,
    '..',
    `idempotency-race-${strategyLabel}-identical-${CONCURRENCY}.json`
  );
  if (!fs.existsSync(file)) return { checksPassed: -1, checksFailed: -1 };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return { checksPassed: parsed.checks?.passes ?? -1, checksFailed: parsed.checks?.fails ?? -1 };
}

async function runCondition(label: 'vulnerable' | 'control', lockTtlMs: string) {
  // The vulnerable condition needs the lock's own critical section (not the
  // post-lock gateway call, which findExisting/createPayment never waits
  // on - see payment.service.ts) to outlive the TTL, hence the synthetic
  // delay rather than MOCK_GATEWAY_LATENCY_MS for that half of the test.
  const criticalSectionDelayMs = label === 'vulnerable' ? LATENCY_MS : '0';
  console.log(
    `\n========== Condition: ${label} (TTL=${lockTtlMs}ms, in-lock synthetic delay=${criticalSectionDelayMs}ms, concurrency=${CONCURRENCY}, trials=${TRIALS}) ==========`
  );
  const backend = await startBackend(lockTtlMs, criticalSectionDelayMs);
  const trialResults: Array<{
    paymentRowCount: number;
    safetyHolds: boolean;
    checksPassed: number;
    checksFailed: number;
  }> = [];
  const strategyLabel = `redis-lock-${label}`;
  try {
    await waitForHealth();
    const { accessToken, merchantId } = await loginOnce();
    for (let trial = 0; trial < TRIALS; trial++) {
      const key = randomUUID();
      runK6({
        BASE_URL,
        STRATEGY: strategyLabel,
        ACCESS_TOKEN: accessToken,
        MERCHANT_ID: merchantId,
        CONCURRENCY,
        MODE: 'identical',
        IDEMPOTENCY_KEY: key,
      });
      const verification = runVerification(key);
      const liveness = readLastRaceLiveness(strategyLabel);
      console.log(
        `  trial ${trial + 1}/${TRIALS}: paymentRowCount=${verification.paymentRowCount} safetyHolds=${verification.safetyHolds} checks=${liveness.checksPassed}/${liveness.checksPassed + liveness.checksFailed} (liveness${liveness.checksFailed > 0 ? ' VIOLATED - unhandled 5xx observed' : ' held'})`
      );
      trialResults.push({ ...verification, ...liveness });
    }
  } finally {
    await killProcessTree(backend);
    await sleep(1500);
  }
  return trialResults;
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const vulnerable = await runCondition('vulnerable', TTL_VULNERABLE_MS);
  const control = await runCondition('control', TTL_CONTROL_MS);

  const summarize = (
    trials: Array<{
      paymentRowCount: number;
      safetyHolds: boolean;
      checksPassed: number;
      checksFailed: number;
    }>
  ) => ({
    trials: trials.length,
    safetyViolations: trials.filter((t) => !t.safetyHolds).length,
    livenessViolations: trials.filter((t) => t.checksFailed > 0).length,
    maxPaymentRowCount: Math.max(...trials.map((t) => t.paymentRowCount)),
    totalUnhandledResponses: trials.reduce((sum, t) => sum + Math.max(t.checksFailed, 0), 0),
    trialDetail: trials,
  });

  const summary = {
    experiment: 'redis-lock TTL-expiry fault injection',
    parameters: {
      concurrency: Number(CONCURRENCY),
      gatewayLatencyMs: Number(LATENCY_MS),
      lockTtlVulnerableMs: Number(TTL_VULNERABLE_MS),
      lockTtlControlMs: Number(TTL_CONTROL_MS),
      trialsPerCondition: TRIALS,
    },
    vulnerable: summarize(vulnerable),
    control: summarize(control),
    timestamp: new Date().toISOString(),
  };

  const outFile = path.join(RESULTS_DIR, `fault-injection-lock-expiry-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n\nSummary written to ${outFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
