import amqplib from 'amqplib';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Minimal RabbitMQ connectivity check. No publishers/consumers are set up -
 * async payment processing via RabbitMQ is intentionally out of scope for
 * this iteration; this exists solely so /health reports real status.
 */
class RabbitMqService {
  public async healthCheck(): Promise<boolean> {
    let connection: Awaited<ReturnType<typeof amqplib.connect>> | undefined;

    try {
      connection = await amqplib.connect(config.rabbitmq.url);
      return true;
    } catch (error) {
      logger.debug({ error }, 'RabbitMQ health check failed');
      return false;
    } finally {
      if (connection) {
        await connection.close().catch(() => undefined);
      }
    }
  }
}

export const rabbitMqService = new RabbitMqService();
