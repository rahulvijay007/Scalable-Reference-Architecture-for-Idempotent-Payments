import { Router, Request, Response } from 'express';
import { body, param } from 'express-validator';
import { apiKeyService } from '../services/api-key.service';
import { prisma } from '../services/database.service';
import { asyncHandler, AppError } from '../middleware/error.middleware';
import { requirePermission, requireMerchantAccess } from '../middleware/authorization.middleware';
import { validate } from '../middleware/validation.middleware';
import { ApiResponse, Permission } from '@payment-platform/shared';

const router: Router = Router();

/**
 * GET /api/merchants/:id
 */
router.get(
  '/:id',
  requirePermission(Permission.READ_MERCHANT),
  requireMerchantAccess('id'),
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const merchant = await prisma.merchant.findUnique({ where: { id: req.params.id } });

    if (!merchant) {
      throw new AppError(404, 'MERCHANT_NOT_FOUND', 'Merchant not found');
    }

    const response: ApiResponse<typeof merchant> = {
      success: true,
      data: merchant,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * GET /api/merchants/:id/api-keys
 */
router.get(
  '/:id/api-keys',
  requirePermission(Permission.READ_API_KEY),
  requireMerchantAccess('id'),
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const apiKeys = await apiKeyService.list(req.params.id);

    const response: ApiResponse<typeof apiKeys> = {
      success: true,
      data: apiKeys,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * POST /api/merchants/:id/api-keys
 * Returns the raw API key once - it cannot be retrieved again after this response.
 */
router.post(
  '/:id/api-keys',
  requirePermission(Permission.CREATE_API_KEY),
  requireMerchantAccess('id'),
  [param('id').isUUID(), body('name').notEmpty().withMessage('Key name is required')],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const permissions: Permission[] = req.body.permissions || [];

    const apiKey = await apiKeyService.create(req.params.id, req.body.name, permissions);

    const response: ApiResponse<typeof apiKey> = {
      success: true,
      data: apiKey,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.status(201).json(response);
  })
);

/**
 * DELETE /api/merchants/:id/api-keys/:keyId
 */
router.delete(
  '/:id/api-keys/:keyId',
  requirePermission(Permission.REVOKE_API_KEY),
  requireMerchantAccess('id'),
  [param('id').isUUID(), param('keyId').isUUID()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    await apiKeyService.revoke(req.params.keyId, req.params.id);

    const response: ApiResponse<null> = {
      success: true,
      data: null,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

export default router;
