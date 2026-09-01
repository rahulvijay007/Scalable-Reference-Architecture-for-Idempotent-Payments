/**
 * Statistical-rigor extension of run-all-benchmarks.ts: runs the
 * throughput-latency benchmark at higher concurrency tiers than the
 * checked-in --light results, REPEATED N times per tier, and reports
 * mean +/- stddev across repeats rather than a single point estimate -
 * the checked-in `--light` results (research/results/throughput-latency-*)
 * are single runs, which is enough to demonstrate the qualitative
 * safety/liveness finding but not enough to support a quantitative
 * throughput/latency claim in a Q1 submission without variance reporting.
 *
 * Runs against the OPTIMISTIC strategy only (the production default) -
 * the qualitative naive-vs-optimistic-vs-redis-lock comparison is already
 * established by the existing results and formal proof; this script's
 * purpose is specifically to put error bars on the production strategy's
 * own performance claim at realistic concurrency.
 *
 * Usage:
 *   pnpm bench:scaled                                   # default tiers/repeats
 *   pnpm bench:scaled -- --vus=1,10,50,100,250 --repeats=5 --duration=15s
 */
import { spawn, spawnSync, ChildProcess } from 'child_process';
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
const RESULTS_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'results');
const SCALED_DIR = path.join(RESULTS_DIR, 'scaled');
const BASE_URL = 'http://localhost:3001';

function argValue(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}

const VUS_TIERS = argValue('vus', '1,10,50,100,250').split(',').map(Number);
const REPEATS = parseInt(argValue('repeats', '5'), 10);
const DURATION = argValue('duration', '15s');

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

function startBackend(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        IDEMPOTENCY_STRATEGY: 'optimistic',
        MOCK_GATEWAY_SUCCESS_RATE: '1',
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

function runK6(vus: number, envVars: Record<string, string>): unknown {
  const envArgs = Object.entries(envVars).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  spawnSync(K6_BIN, ['run', ...envArgs, 'throughput-latency.js'], {
    cwd: K6_DIR,
    stdio: 'inherit',
  });
  const file = path.join(RESULTS_DIR, `throughput-latency-optimistic-${vus}vus.json`);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

async function main() {
  fs.mkdirSync(SCALED_DIR, { recursive: true });

  const backend = await startBackend();
  const tierResults: Record<
    number,
    { throughputRps: number[]; p95Ms: number[]; medianMs: number[]; errors: number[] }
  > = {};

  try {
    await waitForHealth();
    console.log(
      `Backend healthy. Running VUS tiers [${VUS_TIERS.join(', ')}], ${REPEATS} repeats each, ${DURATION} per run.`
    );
    const { accessToken, merchantId } = await loginOnce();
    const auth = { ACCESS_TOKEN: accessToken, MERCHANT_ID: merchantId };

    for (const vus of VUS_TIERS) {
      tierResults[vus] = { throughputRps: [], p95Ms: [], medianMs: [], errors: [] };
      for (let repeat = 0; repeat < REPEATS; repeat++) {
        console.log(`\n--- VUS=${vus}, repeat ${repeat + 1}/${REPEATS} ---`);
        const result = runK6(vus, {
          BASE_URL,
          STRATEGY: 'optimistic',
          VUS: String(vus),
          DURATION,
          ...auth,
        }) as {
          metrics: {
            http_reqs: { rate: number };
            http_req_duration: { 'p(95)': number; med: number };
            lifecycle_errors: { count: number };
          };
        };
        const rps = result.metrics.http_reqs.rate;
        const p95 = result.metrics.http_req_duration['p(95)'];
        const med = result.metrics.http_req_duration.med;
        const errors = result.metrics.lifecycle_errors?.count ?? 0;
        console.log(
          `  throughput=${rps.toFixed(2)} req/s, p95=${p95.toFixed(1)}ms, median=${med.toFixed(1)}ms, errors=${errors}`
        );
        tierResults[vus].throughputRps.push(rps);
        tierResults[vus].p95Ms.push(p95);
        tierResults[vus].medianMs.push(med);
        tierResults[vus].errors.push(errors);

        // Preserve this repeat's raw file before the next repeat overwrites it.
        const rawFile = path.join(RESULTS_DIR, `throughput-latency-optimistic-${vus}vus.json`);
        const preservedFile = path.join(
          SCALED_DIR,
          `throughput-latency-optimistic-${vus}vus-repeat${repeat + 1}.json`
        );
        fs.copyFileSync(rawFile, preservedFile);
      }
    }
  } finally {
    await killProcessTree(backend);
    await sleep(1500);
  }

  const summary = {
    strategy: 'optimistic',
    vusTiers: VUS_TIERS,
    repeatsPerTier: REPEATS,
    durationPerRun: DURATION,
    timestamp: new Date().toISOString(),
    perTier: Object.fromEntries(
      Object.entries(tierResults).map(([vus, r]) => [
        vus,
        {
          throughputRps: {
            mean: mean(r.throughputRps),
            stddev: stddev(r.throughputRps),
            samples: r.throughputRps,
          },
          p95Ms: { mean: mean(r.p95Ms), stddev: stddev(r.p95Ms), samples: r.p95Ms },
          medianMs: { mean: mean(r.medianMs), stddev: stddev(r.medianMs), samples: r.medianMs },
          totalLifecycleErrors: r.errors.reduce((a, b) => a + b, 0),
        },
      ])
    ),
  };

  const summaryFile = path.join(SCALED_DIR, `summary-${Date.now()}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`\n\nSummary written to ${summaryFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
