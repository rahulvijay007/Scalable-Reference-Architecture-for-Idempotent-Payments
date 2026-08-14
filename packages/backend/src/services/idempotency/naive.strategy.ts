import { IdempotencyStrategy, IdempotencyRunContext, IdempotencyStrategyResult } from './idempotency-strategy';

/**
 * BENCHMARK-ONLY BASELINE - reproduces the original (buggy) read-then-write
 * behavior verbatim. This is intentionally NOT the production default.
 *
 * Race condition: between `findExisting()` returning null and `createPayment()`
 * completing, a concurrent request for the same idempotencyKey can also see
 * `existing === null` and also call `createPayment()`. The database's UNIQUE
 * constraint on `idempotencyKey` will reject the second insert with a Prisma
 * P2002 error - which this strategy does not catch, so it propagates as an
 * unhandled 500 INTERNAL_SERVER_ERROR instead of a graceful response. This is
 * the exact defect that motivates the OptimisticStrategy fix; kept here only
 * so the empirical comparison in research/benchmarks has a real baseline.
 */
export class NaiveStrategy implements IdempotencyStrategy {
  public async run(ctx: IdempotencyRunContext): Promise<IdempotencyStrategyResult> {
    const existing = await ctx.findExisting();

    if (existing) {
      const { payment, transaction } = ctx.reconcile(existing);
      return { payment, transaction, isReplay: true };
    }

    const { payment, transaction } = await ctx.createPayment();
    return { payment, transaction, isReplay: false };
  }
}
