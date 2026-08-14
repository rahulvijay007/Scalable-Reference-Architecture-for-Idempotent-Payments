import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const paymentOperationsTotal = new client.Counter({
  name: 'payment_operations_total',
  help: 'Total number of payment operations processed, by operation type and outcome',
  labelNames: ['operation', 'status'],
  registers: [register],
});

/**
 * Express middleware that records request duration per route/method/status.
 * Mount early in the middleware chain so timing includes downstream work.
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;

    httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode.toString() },
      durationSeconds
    );
  });

  next();
};

export const metrics = {
  register,
  httpRequestDuration,
  paymentOperationsTotal,
};
