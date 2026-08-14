import { Router, Request, Response } from 'express';
import { ApiResponse } from '@payment-platform/shared';
import { db } from '../services/database.service';
import { redisService } from '../services/redis.service';
import { rabbitMqService } from '../services/rabbitmq.service';

const router: Router = Router();

type ServiceStatus = 'up' | 'down';

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    rabbitmq: ServiceStatus;
  };
}

router.get('/health', async (_req: Request, res: Response<ApiResponse<HealthCheckResponse>>) => {
  const [databaseUp, redisUp, rabbitmqUp] = await Promise.allSettled([
    db.healthCheck(),
    redisService.healthCheck(),
    rabbitMqService.healthCheck(),
  ]).then((results) => results.map((r) => (r.status === 'fulfilled' ? r.value : false)));

  const services = {
    database: databaseUp ? ('up' as const) : ('down' as const),
    redis: redisUp ? ('up' as const) : ('down' as const),
    rabbitmq: rabbitmqUp ? ('up' as const) : ('down' as const),
  };

  const downCount = Object.values(services).filter((s) => s === 'down').length;
  const status = downCount === 0 ? 'healthy' : databaseUp ? 'degraded' : 'unhealthy';

  const response: ApiResponse<HealthCheckResponse> = {
    success: true,
    data: {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services,
    },
    metadata: {
      timestamp: new Date().toISOString(),
    },
  };

  res.status(status === 'unhealthy' ? 503 : 200).json(response);
});

router.get('/ready', async (_req: Request, res: Response) => {
  // Kubernetes readiness: only report ready if the database is reachable
  const databaseUp = await db.healthCheck();
  res.status(databaseUp ? 200 : 503).send(databaseUp ? 'OK' : 'NOT READY');
});

router.get('/live', async (_req: Request, res: Response) => {
  // Liveness check for Kubernetes - the process responding is enough
  res.status(200).send('OK');
});

export default router;
