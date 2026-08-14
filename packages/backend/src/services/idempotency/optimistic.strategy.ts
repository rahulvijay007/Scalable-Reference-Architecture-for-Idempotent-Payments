import { Prisma } from '@prisma/client';
import { AppError } from '../../middleware/error.middleware';
import { logger } from '../../utils/logger';
import { IdempotencyStrategy, IdempotencyRunContext, IdempotencyStrategyResult } from './idempotency-strategy';

/**
 * PRODUCTION DEFAULT - "optimistic-retry" / "insert-then-reconcile" protocol.
 *
 * Closes the race in NaiveStrategy by treating the database's UNIQUE
 * constraint on `idempotencyKey` as the ultimate arbiter of uniqueness,
 * rather than the earlier `findExisting()` read. If `createPayment()` fails
 * with a Prisma P2002 (unique constraint violation), that means a concurrent
 * request won the race and inserted first; this strategy re-reads the row
 * that request created and reconciles against it exactly as it would have
 * had it seen that row on the first read. No external locking is required -
 * the correctness argument relies only on the database's own atomicity
 * guarantee for the INSERT.
 *
 * See research/formal-model/idempotency-protocol.md for the safety/liveness
 * argument.
 */
export class OptimisticStrategy implements IdempotencyStrategy {
  public async run(ctx: IdempotencyRunContext): Promise<IdempotencyStrategyResult> {
    const existing = await ctx.findExisting();

    if (existing) {
      const { payment, transaction } = ctx.reconcile(existing);
      return { payment, transaction, isReplay: true };
    }

    try {
      const { payment, transaction } = await ctx.createPayment();
      return { payment, transaction, isReplay: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.info(
          { idempotencyKey: ctx.idempotencyKey },
          'Idempotency key unique-constraint conflict on insert - reconciling against the concurrent winner'
        );

        // The winner's Payment + initial Transaction are created atomically
        // (see PaymentService.createAndAuthorize's createPayment closure),
        // so as soon as this P2002 fires the winner's row - transaction
        // included - is guaranteed to already be visible here.
        const raceWinner = await ctx.findExisting();

        if (!raceWinner) {
          // Should be unreachable given the above guarantee; kept as a
          // defensive guard so liveness still holds (a definitive error)
          // rather than an unhandled exception if this invariant is ever
          // broken by a future change.
          throw new AppError(
            500,
            'INTERNAL_SERVER_ERROR',
            'Idempotency key conflict could not be reconciled after a unique-constraint violation'
          );
        }

        const { payment, transaction } = ctx.reconcile(raceWinner);
        return { payment, transaction, isReplay: true };
      }

      throw error;
    }
  }
}
