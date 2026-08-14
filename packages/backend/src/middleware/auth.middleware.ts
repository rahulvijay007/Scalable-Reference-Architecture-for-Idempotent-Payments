import { Request, Response, NextFunction } from 'express';
import { JWTPayload } from '@payment-platform/shared';
import { authService } from '../services/auth.service';
import { AppError } from './error.middleware';
import { logger } from '../utils/logger';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- ambient global augmentation requires a namespace; there is no ES module equivalent
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * Middleware to authenticate requests with JWT
 */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'MISSING_TOKEN', 'Authentication token is required');
    }

    const token = authHeader.substring(7);

    try {
      const payload = authService.verifyAccessToken(token);
      req.user = payload;

      logger.debug(
        { userId: payload.userId, role: payload.role },
        'Request authenticated'
      );

      next();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user is authenticated (optional)
 */
export const optionalAuthenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      try {
        const payload = authService.verifyAccessToken(token);
        req.user = payload;
      } catch (error) {
        // Ignore errors for optional authentication
        logger.debug('Optional authentication failed');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
