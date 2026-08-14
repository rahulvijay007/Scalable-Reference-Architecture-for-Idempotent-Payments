import { Request, Response, NextFunction } from 'express';
import { hashData, Permission, UserRole } from '@payment-platform/shared';
import { prisma } from '../services/database.service';
import { AppError } from './error.middleware';
import { authenticate } from './auth.middleware';
import { logger } from '../utils/logger';

/**
 * Middleware to authenticate requests carrying an X-API-Key header.
 * Synthesizes a JWTPayload-shaped req.user from the key's merchant/permissions
 * so downstream requirePermission/requireMerchantAccess work unchanged.
 */
export const authenticateApiKey = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

    if (!apiKeyHeader) {
      throw new AppError(401, 'MISSING_API_KEY', 'X-API-Key header is required');
    }

    const keyHash = hashData(apiKeyHeader);
    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

    if (!apiKey || !apiKey.isActive) {
      throw new AppError(401, 'INVALID_API_KEY', 'Invalid or inactive API key');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new AppError(401, 'EXPIRED_API_KEY', 'API key has expired');
    }

    // Fire-and-forget last-used timestamp update; don't block the request on it
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch((error) => logger.error({ error, apiKeyId: apiKey.id }, 'Failed to update API key lastUsedAt'));

    const merchant = await prisma.merchant.findUnique({ where: { id: apiKey.merchantId } });

    if (!merchant || !merchant.isActive) {
      throw new AppError(403, 'MERCHANT_INACTIVE', 'Merchant account is inactive');
    }

    const permissions = (apiKey.permissions as Permission[]) || [];

    req.user = {
      userId: `api-key:${apiKey.id}`,
      email: merchant.email,
      role: UserRole.MERCHANT,
      merchantId: apiKey.merchantId,
      permissions,
    };

    logger.debug({ apiKeyId: apiKey.id, merchantId: apiKey.merchantId }, 'Request authenticated via API key');

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Accepts either a JWT bearer token or an X-API-Key header, trying JWT first.
 * Lets the dashboard (JWT) and programmatic integrations (API key) share the
 * same routes and permission middleware.
 */
export const authenticateAny = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }

  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }

  next(new AppError(401, 'MISSING_CREDENTIALS', 'Authentication token or API key is required'));
};
