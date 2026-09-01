import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { AppError } from '../../middleware/error.middleware';
import { acquireLock, releaseLock } from './redis-lock';
import {
  IdempotencyStrategy,
  IdempotencyRunContext,
  IdempotencyStrategyResult,
} from './idempotency-strategy';

const LOCK_ACQUIRE_ATTEMPTS = 3;
const LOCK_ACQUIRE_RETRY_DELAY_MS = 100;

/**
 * PESSIMISTIC-LOCK ALTERNATIVE - wraps the entire check-then-create critical
 * section in a Redis-based mutual-exclusion lock (SET NX PX), so only one
 * request per idempotency key ever reaches `findExisting`/`createPayment` at
 * a time. No database-level race is possible while the lock is held.
 *
 * Tradeoffs vs. OptimisticStrategy (see research/formal-model/idempotency-protocol.md):
 * - Adds a hard dependency on Redis being available; an outage here fails
 *   closed (423 LOCKED) rather than degrading gracefully.
 * - Liveness depends on TTL tuning: if the critical section legitimately
 *   takes longer than `IDEMPOTENCY_LOCK_TTL_MS`, the lock can expire while
 *   still "in use," reopening the race the lock exists to prevent. If the
 *   lock holder crashes mid-section, the TTL is what eventually frees the
 *   lock for other callers (no independent liveness guarantee beyond TTL
 *   expiry).
 */
export class RedisLockStrategy implements IdempotencyStrategy {
  public async run(ctx: IdempotencyRunContext): Promise<IdempotencyStrategyResult> {
    const lockKey = `idempotency-lock:${ctx.idempotencyKey}`;
    const lockValue = uuidv4();

    let acquired = false;
    for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS && !acquired; attempt++) {
      acquired = await acquireLock(lockKey, lockValue, config.idempotency.lockTtlMs);
      if (!acquired && attempt < LOCK_ACQUIRE_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_ACQUIRE_RETRY_DELAY_MS));
      }
    }

    if (!acquired) {
      throw new AppError(
        423,
        'LOCKED',
        'A concurrent request for this idempotency key is already being processed - retry shortly'
      );
    }

    try {
      const existing = await ctx.findExisting();

      if (existing) {
        const { payment, transaction } = ctx.reconcile(existing);
        return { payment, transaction, isReplay: true };
      }

      // Synthetic, off-by-default (see config/index.ts) delay for
      // fault-injection research only - simulates a critical section slow
      // enough to outlive the lock's TTL, to empirically reproduce the
      // weakness documented above rather than leaving it as prose-only.
      if (config.idempotency.debugCriticalSectionDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.idempotency.debugCriticalSectionDelayMs)
        );
      }

      const { payment, transaction } = await ctx.createPayment();
      return { payment, transaction, isReplay: false };
    } finally {
      await releaseLock(lockKey, lockValue);
    }
  }
}
