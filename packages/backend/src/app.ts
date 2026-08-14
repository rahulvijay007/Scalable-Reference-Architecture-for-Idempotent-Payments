import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';
import { apiLimiter } from './middleware/rate-limit.middleware';
import { metricsMiddleware, metrics } from './middleware/metrics.middleware';
import { authenticateAny } from './middleware/api-key.middleware';
import { conditionalHmac } from './middleware/hmac.middleware';
import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';
import paymentRoutes from './routes/payment.routes';
import merchantRoutes from './routes/merchant.routes';
import benchRoutes from './routes/bench.routes';

export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression middleware
  app.use(compression());

  // Request logging & metrics
  app.use(requestLogger);
  app.use(metricsMiddleware);

  // Rate limiting
  app.use('/api', apiLimiter);

  // Health check routes (no rate limiting)
  app.use(healthRoutes);

  // Prometheus scrape endpoint (outside /api so it isn't rate limited)
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/payments', authenticateAny, conditionalHmac, paymentRoutes);
  app.use('/api/merchants', authenticateAny, conditionalHmac, merchantRoutes);
  // Benchmark-only, see routes/bench.routes.ts - used by research/benchmarks/k6/rbac-overhead.js
  app.use('/api/_bench', authenticateAny, benchRoutes);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
