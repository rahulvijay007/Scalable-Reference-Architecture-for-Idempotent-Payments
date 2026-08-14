import { Router, Request, Response } from 'express';
import { requirePermission } from '../middleware/authorization.middleware';
import { Permission, ApiResponse } from '@payment-platform/shared';

/**
 * Benchmark-only routes, used exclusively by
 * research/benchmarks/k6/rbac-overhead.js to isolate the cost of
 * authentication + permission-checking middleware from any downstream
 * database work. Not part of the product API surface - no data access, no
 * side effects, response is a fixed trivial payload.
 */
const router: Router = Router();

router.get(
  '/rbac-check',
  requirePermission(Permission.READ_PAYMENT),
  (_req: Request, res: Response<ApiResponse<{ ok: true }>>) => {
    res.json({ success: true, data: { ok: true }, metadata: { timestamp: new Date().toISOString() } });
  }
);

export default router;
