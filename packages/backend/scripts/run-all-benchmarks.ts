/**
 * Orchestrates the k6 benchmarks in research/benchmarks/k6/ across the
 * three idempotency strategies. For each strategy: spawns the backend with
 * IDEMPOTENCY_STRATEGY=<strategy> and MOCK_GATEWAY_SUCCESS_RATE=1 (for
 * deterministic gateway behavior), waits for /health, runs the k6 scripts,
 * verifies idempotency-race correctness against the database, then tears
 * the backend down before moving to the next strategy.
 *
 * Preconditions (not owned by this script - see research/REPRODUCE.md):
 *   - docker compose up -d postgres redis   (redis only needed for redis-lock runs)
 *   - pnpm --filter backend prisma:migrate && pnpm --filter backend prisma:seed
 *   - k6 installed and on PATH
 *
 * Usage:
 *   tsx scripts/run-all-benchmarks.ts [--strategies=optimistic,naive,redis-lock] [--light]
 *
 * --light runs a reduced concurrency/duration matrix (useful for a quick
 * smoke run before committing to the full matrix).
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

  return 'k6'; // fall back to PATH resolution
}

const K6_BIN = resolveK6Binary();
const BACKEND_DIR = path.resolve(__dirname, '..');
const K6_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'benchmarks', 'k6');
const RESULTS_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'results');
const BASE_URL = 'http://localhost:3001';

const argStrategies = process.argv.find((a) => a.startsWith('--strategies='));
const STRATEGIES = argStrategies
  ? argStrategies.split('=')[1].split(',')
  : ['optimistic', 'naive', 'redis-lock'];

const LIGHT = process.argv.includes('--light');
const THROUGHPUT_VUS = LIGHT ? [1, 10] : [1, 10, 25, 50];
const THROUGHPUT_DURATION = LIGHT ? '8s' : '15s';
const RACE_CONCURRENCY = LIGHT ? [10] : [10, 30, 50];

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

function startBackend(strategy: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        IDEMPOTENCY_STRATEGY: strategy,
        MOCK_GATEWAY_SUCCESS_RATE: '1',
        PORT: '3001',
        // The general API rate limiter (100 req/min default) is a separate
        // concern from the idempotency protocol under test here - left at
        // its production default, sustained k6 load would trip it and
        // produce 429s that have nothing to do with strategy correctness,
        // silently corrupting the throughput/latency numbers. Raised only
        // for benchmark runs.
        RATE_LIMIT_MAX_REQUESTS: '1000000',
      },
      stdio: 'pipe',
      shell: true,
    });

    let resolved = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (!resolved && /Server running on port/.test(text)) {
        resolved = true;
        resolve(child);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!resolved) reject(new Error(`Backend exited early with code ${code} before becoming ready`));
    });

    // Fallback: even if we miss the log line, waitForHealth() will confirm readiness.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    }, 5000);
  });
}

async function loginOnce(): Promise<{ accessToken: string; merchantId: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'merchant@payment-platform.com', password: 'Merchant@123456' }),
  });

  if (!res.ok) {
    throw new Error(`Orchestrator login failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { data: { accessToken: string; user: { merchantId: string } } };
  return { accessToken: body.data.accessToken, merchantId: body.data.user.merchantId };
}

function runK6(scriptFile: string, envVars: Record<string, string>): void {
  const envArgs = Object.entries(envVars).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const loggable = Object.entries(envVars)
    .filter(([k]) => k !== 'ACCESS_TOKEN')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`\n>>> k6 run ${scriptFile} ${loggable}`);
  // No `shell: true` here: on Windows, running a quoted/spaced executable
  // path (e.g. "C:\Program Files\k6\k6.exe") through cmd.exe requires extra
  // quoting spawnSync doesn't add automatically, and breaks with "'C:\Program'
  // is not recognized...". Running the exe directly (no shell) avoids that
  // entirely and works fine for a plain executable + argv array.
  const result = spawnSync(K6_BIN, ['run', ...envArgs, scriptFile], {
    cwd: K6_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn(`k6 run exited with status ${result.status} for ${scriptFile}`);
  }
}

function runVerification(idempotencyKey: string, resultFile: string): boolean {
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/verify-idempotency.ts', idempotencyKey, resultFile], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

async function runStrategy(strategy: string): Promise<void> {
  console.log(`\n========== Strategy: ${strategy} ==========`);

  if (strategy === 'redis-lock') {
    console.log('(redis-lock strategy requires Redis to be running: docker compose up -d redis)');
  }

  const backend = await startBackend(strategy);

  try {
    await waitForHealth();
    console.log(`Backend healthy under IDEMPOTENCY_STRATEGY=${strategy}`);

    // Log in once per strategy and reuse the token across every k6 script
    // invocation below - each script's own setup() would otherwise call
    // /api/auth/login independently, and this loop calls k6 far more than
    // 5 times per strategy, which would trip the auth endpoint's 5
    // attempts/15min rate limiter partway through.
    const { accessToken, merchantId } = await loginOnce();
    const auth = { ACCESS_TOKEN: accessToken, MERCHANT_ID: merchantId };

    // 1. Throughput/latency at increasing concurrency
    for (const vus of THROUGHPUT_VUS) {
      runK6('throughput-latency.js', {
        BASE_URL,
        STRATEGY: strategy,
        VUS: String(vus),
        DURATION: THROUGHPUT_DURATION,
        ...auth,
      });
    }

    // 2. Idempotency race - identical payload
    for (const concurrency of RACE_CONCURRENCY) {
      const key = randomUUID();
      runK6('idempotency-race.js', {
        BASE_URL,
        STRATEGY: strategy,
        ...auth,
        CONCURRENCY: String(concurrency),
        MODE: 'identical',
        IDEMPOTENCY_KEY: key,
      });
      const resultFile = path.join(RESULTS_DIR, `idempotency-race-${strategy}-identical-${concurrency}.json`);
      const ok = runVerification(key, resultFile);
      console.log(`Verification (identical, concurrency=${concurrency}): ${ok ? 'SAFE' : 'VIOLATION'}`);
    }

    // 3. Idempotency race - conflicting payloads
    for (const concurrency of RACE_CONCURRENCY) {
      const key = randomUUID();
      runK6('idempotency-race.js', {
        BASE_URL,
        STRATEGY: strategy,
        ...auth,
        CONCURRENCY: String(concurrency),
        MODE: 'conflict',
        IDEMPOTENCY_KEY: key,
      });
      const resultFile = path.join(RESULTS_DIR, `idempotency-race-${strategy}-conflict-${concurrency}.json`);
      const ok = runVerification(key, resultFile);
      console.log(`Verification (conflict, concurrency=${concurrency}): ${ok ? 'SAFE' : 'VIOLATION'}`);
    }

    // 4. RBAC overhead (strategy-independent, but cheap enough to run once per strategy loop pass is wasteful - run only for the first strategy)
    if (strategy === STRATEGIES[0]) {
      runK6('rbac-overhead.js', { BASE_URL, VUS: '20', DURATION: LIGHT ? '8s' : '15s', ACCESS_TOKEN: accessToken });
    }
  } finally {
    await killProcessTree(backend);
    await sleep(1500); // let the OS release port 3001 before the next strategy
  }
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  for (const strategy of STRATEGIES) {
    await runStrategy(strategy);
  }

  console.log('\nAll benchmark runs complete. Results in', RESULTS_DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
