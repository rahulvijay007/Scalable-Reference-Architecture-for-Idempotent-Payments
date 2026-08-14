import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '@payment-platform/shared';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response<ApiResponse<never>>,
  _next: NextFunction
) => {
  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
      body: req.body,
      query: req.query,
    },
    'Request error'
  );

  if (err instanceof AppError) {
    const errorResponse: ApiResponse<never> = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    return res.status(err.statusCode).json(errorResponse);
  }

  // Unknown error
  const errorResponse: ApiResponse<never> = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
    metadata: {
      timestamp: new Date().toISOString(),
    },
  };

  return res.status(500).json(errorResponse);
};

export const notFoundHandler = (req: Request, res: Response<ApiResponse<never>>) => {
  const errorResponse: ApiResponse<never> = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    metadata: {
      timestamp: new Date().toISOString(),
    },
  };

  res.status(404).json(errorResponse);
};

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
