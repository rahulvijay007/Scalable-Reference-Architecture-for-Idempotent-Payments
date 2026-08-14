import { Router, Request, Response } from 'express';
import { body, param, query } from 'express-validator';
import { paymentService } from '../services/payment.service';
import { asyncHandler } from '../middleware/error.middleware';
import { requirePermission, requireMerchantAccess } from '../middleware/authorization.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  ApiResponse,
  CreatePaymentRequest,
  Permission,
  PaymentStatus,
} from '@payment-platform/shared';

const router: Router = Router();

function operationContext(req: Request) {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    merchantId: req.user!.merchantId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

/**
 * POST /api/payments
 * Create a payment and attempt authorization
 */
router.post(
  '/',
  requirePermission(Permission.CREATE_PAYMENT),
  requireMerchantAccess('merchantId'),
  [
    body('merchantId').isUUID().withMessage('Valid merchantId is required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('currency').notEmpty().withMessage('Currency is required'),
    body('paymentMethod').notEmpty().withMessage('Payment method is required'),
    body('idempotencyKey').isUUID().withMessage('idempotencyKey must be a valid UUID'),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreatePaymentRequest = req.body;

    const { payment, transaction } = await paymentService.createAndAuthorize(data, {
      userId: req.user!.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    const response: ApiResponse<typeof payment & { transaction: typeof transaction }> = {
      success: true,
      data: { ...payment, transaction } as never,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.status(201).json(response);
  })
);

/**
 * GET /api/payments
 * List payments (paginated, filterable)
 */
router.get(
  '/',
  requirePermission(Permission.READ_PAYMENT),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(Object.values(PaymentStatus)),
  ],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    // Non-admins are always scoped to their own merchant
    const merchantId =
      req.user!.role === 'ADMIN' ? (req.query.merchantId as string | undefined) : req.user!.merchantId;

    const result = await paymentService.list({
      merchantId,
      status: req.query.status as PaymentStatus | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });

    const response: ApiResponse<typeof result.payments> = {
      success: true,
      data: result.payments,
      metadata: { ...result.pagination, timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * GET /api/payments/:id
 * Get a single payment with its transaction history
 */
router.get(
  '/:id',
  requirePermission(Permission.READ_PAYMENT),
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentService.getById(req.params.id, {
      userId: req.user!.userId,
      role: req.user!.role,
      merchantId: req.user!.merchantId,
    });

    const response: ApiResponse<typeof payment> = {
      success: true,
      data: payment,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * POST /api/payments/:id/capture
 */
router.post(
  '/:id/capture',
  requirePermission(Permission.CAPTURE_PAYMENT),
  [param('id').isUUID(), body('amount').optional().isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const { payment, transaction } = await paymentService.capture(
      req.params.id,
      { amount: req.body.amount, metadata: req.body.metadata },
      operationContext(req)
    );

    const response: ApiResponse<typeof payment & { transaction: typeof transaction }> = {
      success: true,
      data: { ...payment, transaction } as never,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * POST /api/payments/:id/refund
 */
router.post(
  '/:id/refund',
  requirePermission(Permission.REFUND_PAYMENT),
  [param('id').isUUID(), body('amount').optional().isFloat({ gt: 0 }), body('reason').optional().isString()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const { payment, transaction } = await paymentService.refund(
      req.params.id,
      { amount: req.body.amount, reason: req.body.reason, metadata: req.body.metadata },
      operationContext(req)
    );

    const response: ApiResponse<typeof payment & { transaction: typeof transaction }> = {
      success: true,
      data: { ...payment, transaction } as never,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

/**
 * POST /api/payments/:id/cancel
 */
router.post(
  '/:id/cancel',
  requirePermission(Permission.CANCEL_PAYMENT),
  [param('id').isUUID(), body('reason').optional().isString()],
  validate,
  asyncHandler(async (req: Request, res: Response) => {
    const { payment, transaction } = await paymentService.cancel(
      req.params.id,
      { reason: req.body.reason, metadata: req.body.metadata },
      operationContext(req)
    );

    const response: ApiResponse<typeof payment & { transaction: typeof transaction }> = {
      success: true,
      data: { ...payment, transaction } as never,
      metadata: { timestamp: new Date().toISOString() },
    };

    res.json(response);
  })
);

export default router;
