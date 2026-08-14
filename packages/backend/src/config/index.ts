import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Application
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/payment_platform',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD,
  },

  // RabbitMQ
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key',
    accessTokenExpiry: process.env.JWT_ACCESS_TOKEN_EXPIRY || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_TOKEN_EXPIRY || '7d',
  },

  // HMAC
  hmac: {
    secret: process.env.HMAC_SECRET || 'your-hmac-secret-key',
    // When enabled, requests carrying an X-Signature header must pass HMAC
    // verification. Requests without the header are unaffected either way -
    // this lets API-key callers opt into request signing without breaking
    // the JWT-based dashboard, which never sends X-Signature.
    enabled: process.env.HMAC_VERIFICATION_ENABLED === 'true',
  },

  // Encryption
  encryption: {
    key: process.env.API_KEY_ENCRYPTION_KEY || '00000000000000000000000000000000', // 32 bytes
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // Elasticsearch
  elasticsearch: {
    url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    user: process.env.ELASTICSEARCH_USER,
    password: process.env.ELASTICSEARCH_PASSWORD,
  },

  // Mock Payment Gateway
  mockGateway: {
    successRate: parseFloat(process.env.MOCK_GATEWAY_SUCCESS_RATE || '0.95'),
    latencyMs: parseInt(process.env.MOCK_GATEWAY_LATENCY_MS || '100', 10),
  },

  // Idempotency strategy (research: see research/formal-model/idempotency-protocol.md)
  // 'optimistic' is the correct, production-default protocol. 'naive' and
  // 'redis-lock' exist for the empirical benchmark comparison in
  // research/benchmarks - never set 'naive' outside of that benchmark.
  idempotency: {
    strategy: (process.env.IDEMPOTENCY_STRATEGY || 'optimistic') as 'naive' | 'optimistic' | 'redis-lock',
    lockTtlMs: parseInt(process.env.IDEMPOTENCY_LOCK_TTL_MS || '5000', 10),
  },
};
