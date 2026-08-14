import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';

async function startServer() {
  try {
    const app = createApp();

    const server = app.listen(config.port, () => {
      logger.info(`🚀 Server running on port ${config.port} in ${config.env} mode`);
      logger.info(`📝 Health check available at http://localhost:${config.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown`);

      server.close(() => {
        logger.info('HTTP server closed');

        // Close database connections, message queues, etc.
        // await prisma.$disconnect();
        // await redis.quit();
        // await rabbitmqConnection.close();

        logger.info('All connections closed, exiting process');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error(error, 'Failed to start server');
    process.exit(1);
  }
}

startServer();
