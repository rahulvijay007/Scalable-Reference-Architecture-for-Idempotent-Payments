import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

class DatabaseService {
  private static instance: DatabaseService;
  public prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      this.prisma.$on('query' as never, (e: any) => {
        logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'Database query');
      });
    }

    this.prisma.$on('error' as never, (e: any) => {
      logger.error({ error: e }, 'Database error');
    });

    this.prisma.$on('warn' as never, (e: any) => {
      logger.warn({ warning: e }, 'Database warning');
    });
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      logger.info('✅ Database connected successfully');
    } catch (error) {
      logger.error(error, 'Failed to connect to database');
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('Database disconnected');
    } catch (error) {
      logger.error(error, 'Error disconnecting from database');
      throw error;
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error(error, 'Database health check failed');
      return false;
    }
  }
}

export const db = DatabaseService.getInstance();
export const prisma = db.prisma;
