import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { ApiResponse } from '@payment-platform/shared';

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorResponse: ApiResponse<never> = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array().reduce((acc, err) => {
          if ('path' in err) {
            acc[err.path] = err.msg;
          }
          return acc;
        }, {} as Record<string, string>),
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(400).json(errorResponse);
    return;
  }

  next();
};
