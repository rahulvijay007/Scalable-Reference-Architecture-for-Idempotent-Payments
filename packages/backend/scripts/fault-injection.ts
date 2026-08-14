/**
 * Observability demonstration: starts the backend with a deliberately
 * degraded mock-gateway success rate, runs a sustained k6 load burst so
 * Prometheus accumulates several scrape intervals of data, then queries
 * Prometheus's HTTP API directly for the same PromQL expressions used in
 * infrastructure/grafana/dashboards/payment-platform.json - producing the
 * raw JSON that would back a "here's what an incident looks like in the
 * dashboard" figure.
 *
 * Preconditions: docker compose up -d postgres prometheus grafana
 * (prometheus must be able to reach the backend at host.docker.internal:3001,
 * per infrastructure/prometheus/prometheus.yml's scrape config).
 *
 * Usage: tsx scripts/fault-injection.ts [--duration=90] [--success-rate=0.3]
 */
import { spawn, spawnSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const BACKEND_DIR = path.resolve(__dirname, '..');
const K6_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'benchmarks', 'k6');
const RESULTS_DIR = path.resolve(BACKEND_DIR, '..', '..', 'research', 'results', 'observability');
const BASE_URL = 'http://localhost:3001';
const PROMETHEUS_URL = 'http://localhost:9090';

const durationArg = process.argv.find((a) => a.startsWith('--duration='));
const DURATION_SECONDS = durationArg ? parseInt(durationArg.split('=')[1], 10) : 90;
const rateArg = process.argv.find((a) => a.startsWith('--success-rate='));
const SUCCESS_RATE = rateArg ? rateArg.split('=')[1] : '0.3';

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      const body = (await res.json()) as { data?: { services?: { database?: string } } };
      if (body.data?.services?.database === 'up') return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms`);
}

async function waitForPrometheusTarget(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
      const body = (await res.json()) as {
        data: { activeTargets: Array<{ labels: { job: string }; health: string }> };
      };
      const target = body.data.activeTargets.find((t) => t.labels.job === 'payment-api');
      if (target?.health === 'up') return;
    } catch {
      // Prometheus not reachable yet
    }
    await sleep(1000);
  }
  console.warn('Warning: could not confirm Prometheus has the payment-api target up within timeout - proceeding anyway.');
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
        MOCK_GATEWAY_SUCCESS_RATE: SUCCESS_RATE,
        RATE_LIMIT_MAX_REQUESTS: '1000000',
        PORT: '3001',
      },
      stdio: 'pipe',
      shell: true,
    });

    let resolved = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!resolved && /Server running on port/.test(chunk.toString())) {
        resolved = true;
        resolve(child);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!resolved) reject(new Error(`Backend exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    }, 5000);
  });
}

async function queryPrometheusRange(promql: string, startTs: number, endTs: number): Promise<unknown> {
  const url = new URL(`${PROMETHEUS_URL}/api/v1/query_range`);
  url.searchParams.set('query', promql);
  url.searchParams.set('start', String(startTs));
  url.searchParams.set('end', String(endTs));
  url.searchParams.set('step', '15s');

  const res = await fetch(url.toString());
  return res.json();
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  console.log(`Starting backend with MOCK_GATEWAY_SUCCESS_RATE=${SUCCESS_RATE} (degraded)...`);
  const backend = await startBackend();

  try {
    await waitForHealth();
    console.log('Backend healthy. Waiting for Prometheus to confirm scrape target is up...');
    await waitForPrometheusTarget();

    const burstStart = Math.floor(Date.now() / 1000);
    console.log(`Running k6 load burst for ${DURATION_SECONDS}s to generate failure-rate signal...`);

    const k6Bin = resolveK6Binary();
    spawnSync(
      k6Bin,
      [
        'run',
        '--env',
        `BASE_URL=${BASE_URL}`,
        '--env',
        'STRATEGY=fault-injection',
        '--env',
        'VUS=10',
        '--env',
        `DURATION=${DURATION_SECONDS}s`,
        'throughput-latency.js',
      ],
      { cwd: K6_DIR, stdio: 'inherit' }
    );

    const burstEnd = Math.floor(Date.now() / 1000);

    // Let Prometheus scrape the tail end of the burst (scrape_interval: 15s)
    await sleep(20000);

    console.log('Querying Prometheus for the failure-rate and latency signal during the burst...');

    const failureRatio = await queryPrometheusRange(
      'sum(rate(payment_operations_total{status="failure"}[1m])) / sum(rate(payment_operations_total[1m]))',
      burstStart,
      burstEnd + 20
    );
    const p95Latency = await queryPrometheusRange(
      'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))',
      burstStart,
      burstEnd + 20
    );

    const outFile = path.join(RESULTS_DIR, `fault-injection-${Date.now()}.json`);
    fs.writeFileSync(
      outFile,
      JSON.stringify(
        {
          successRate: SUCCESS_RATE,
          durationSeconds: DURATION_SECONDS,
          burstStart,
          burstEnd,
          failureRatio,
          p95Latency,
        },
        null,
        2
      )
    );

    console.log(`Saved: ${outFile}`);
  } finally {
    await killProcessTree(backend);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
