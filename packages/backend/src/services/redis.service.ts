import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Minimal Redis client, used today only for connectivity health checks.
 * Caching logic is intentionally out of scope for this iteration.
 */
class RedisService {
  private client: Redis;

  constructor() {
    this.client = new Redis(config.redis.url, {
      password: config.redis.password,
      lazyConnect: true,
      retryStrategy: () => null, // don't retry forever for a health-check-only client
      maxRetriesPerRequest: 1,
    });

    this.client.on('error', (error) => {
      logger.debug({ error }, 'Redis connection error');
    });
  }

  public async healthCheck(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.debug({ error }, 'Redis health check failed');
      return false;
    }
  }
}

export const redisService = new RedisService();
