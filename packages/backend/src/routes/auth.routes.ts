import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authService } from '../services/auth.service';
import { asyncHandler, AppError } from '../middleware/error.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { authLimiter } from '../middleware/rate-limit.middleware';
import { ApiResponse, LoginRequest, RegisterRequest } from '@payment-platform/shared';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const data: RegisterRequest = req.body;

    const result = await authService.register(data);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(201).json(response);
  })
);

/**
 * POST /api/auth/login
 * Login user
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const data: LoginRequest = req.body;

    const result = await authService.login(data);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    const result = await authService.refreshAccessToken(refreshToken);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

/**
 * POST /api/auth/logout
 * Logout user (revoke refresh token)
 */
router.post(
  '/logout',
  authenticate,
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    await authService.logout(refreshToken);

    const response: ApiResponse<null> = {
      success: true,
      data: null,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'User not authenticated');
    }

    const user = await authService.getUserById(req.user.userId);

    const response: ApiResponse<typeof user> = {
      success: true,
      data: user,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

export default router;
