import { Request, Response, NextFunction } from 'express';
import { Permission, UserRole } from '@payment-platform/shared';
import { AppError } from './error.middleware';
import { logger } from '../utils/logger';

/**
 * Middleware to check if user has required permission
 */
export const requirePermission = (...permissions: Permission[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      const userPermissions = req.user.permissions || [];

      // Check if user has at least one of the required permissions
      const hasPermission = permissions.some((permission) =>
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        logger.warn(
          {
            userId: req.user.userId,
            required: permissions,
            actual: userPermissions,
          },
          'Permission denied'
        );

        throw new AppError(
          403,
          'INSUFFICIENT_PERMISSIONS',
          'You do not have permission to perform this action'
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if user has required role
 */
export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      if (!roles.includes(req.user.role)) {
        logger.warn(
          {
            userId: req.user.userId,
            required: roles,
            actual: req.user.role,
          },
          'Role check failed'
        );

        throw new AppError(403, 'INSUFFICIENT_PERMISSIONS', 'Insufficient role privileges');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if user belongs to specific merchant
 */
export const requireMerchantAccess = (merchantIdParam: string = 'merchantId') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      // Admin users have access to all merchants
      if (req.user.role === UserRole.ADMIN) {
        return next();
      }

      const requestedMerchantId = req.params[merchantIdParam] || req.body.merchantId;

      if (!requestedMerchantId) {
        throw new AppError(400, 'MISSING_MERCHANT_ID', 'Merchant ID is required');
      }

      if (req.user.merchantId !== requestedMerchantId) {
        logger.warn(
          {
            userId: req.user.userId,
            userMerchantId: req.user.merchantId,
            requestedMerchantId,
          },
          'Merchant access denied'
        );

        throw new AppError(403, 'MERCHANT_ACCESS_DENIED', 'You do not have access to this merchant');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to check if user can access resource (either owns it or is admin)
 */
export const requireOwnershipOrAdmin = (ownerIdParam: string = 'userId') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
      }

      // Admin users have access to all resources
      if (req.user.role === UserRole.ADMIN) {
        return next();
      }

      const resourceOwnerId = req.params[ownerIdParam] || req.body.userId;

      if (!resourceOwnerId) {
        throw new AppError(400, 'MISSING_OWNER_ID', 'Owner ID is required');
      }

      if (req.user.userId !== resourceOwnerId) {
        logger.warn(
          {
            userId: req.user.userId,
            resourceOwnerId,
          },
          'Ownership check failed'
        );

        throw new AppError(403, 'ACCESS_DENIED', 'You do not have access to this resource');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
