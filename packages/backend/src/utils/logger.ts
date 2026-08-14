import pino from 'pino';
import { config } from '../config';

// Never let raw card data, tokens, or API keys reach log output/Elasticsearch,
// even when a whole request body gets logged on error (see error.middleware.ts).
// Exported (not just inlined below) so tests can verify the *actual*
// production redaction config rather than a hand-copied duplicate that could
// drift out of sync - see security.adversarial.integration.test.ts.
export const LOG_REDACT_CONFIG = {
  paths: [
    'body.cardDetails.cardNumber',
    'body.cardDetails.cvv',
    'req.body.cardDetails.cardNumber',
    'req.body.cardDetails.cvv',
    '*.cardNumber',
    '*.cvv',
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'headers.authorization',
    'headers["x-api-key"]',
  ],
  censor: '[REDACTED]',
};

export const logger = pino({
  level: config.isDevelopment ? 'debug' : 'info',
  transport: config.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: LOG_REDACT_CONFIG,
});
