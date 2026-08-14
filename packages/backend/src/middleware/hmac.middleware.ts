import { Request, Response, NextFunction } from 'express';
import { generateHmacSignature, verifyHmacSignature } from '@payment-platform/shared';
import { config } from '../config';
import { AppError } from './error.middleware';
import { logger } from '../utils/logger';

/**
 * Middleware to verify HMAC signature for API requests
 */
export const verifyHmac = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['x-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;

    if (!signature) {
      throw new AppError(401, 'MISSING_SIGNATURE', 'HMAC signature is required');
    }

    if (!timestamp) {
      throw new AppError(401, 'MISSING_TIMESTAMP', 'Request timestamp is required');
    }

    // Check timestamp to prevent replay attacks (5 minute window)
    const requestTime = parseInt(timestamp, 10);
    const currentTime = Date.now();
    const timeDiff = Math.abs(currentTime - requestTime);

    if (timeDiff > 5 * 60 * 1000) {
      throw new AppError(401, 'EXPIRED_REQUEST', 'Request timestamp is too old');
    }

    // Construct payload for signature verification
    const payload = JSON.stringify({
      method: req.method,
      path: req.path,
      timestamp,
      body: req.body,
    });

    // Verify signature
    const isValid = verifyHmacSignature(payload, signature, config.hmac.secret);

    if (!isValid) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid HMAC signature');
    }

    logger.debug('HMAC signature verified');
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Verifies HMAC only when request signing is enabled via config AND the
 * caller actually sent an X-Signature header. This lets HMAC-signing
 * integrations opt in without requiring every caller (e.g. the JWT-based
 * dashboard) to compute signatures.
 */
export const conditionalHmac = (req: Request, res: Response, next: NextFunction) => {
  if (!config.hmac.enabled || !req.headers['x-signature']) {
    return next();
  }

  return verifyHmac(req, res, next);
};

/**
 * Generate HMAC signature for outgoing requests
 */
export function createHmacSignature(
  method: string,
  path: string,
  body: any
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();

  const payload = JSON.stringify({
    method,
    path,
    timestamp,
    body,
  });

  const signature = generateHmacSignature(payload, config.hmac.secret);

  return { signature, timestamp };
}
