import { Payment, Transaction } from '@prisma/client';

export type PaymentWithLatestTransaction = Payment & { transactions: Transaction[] };

/**
 * The operations an IdempotencyStrategy needs from the caller. Card
 * validation and the actual INSERT live inside `createPayment` (supplied by
 * PaymentService) so each strategy only has to reason about *when* and *how
 * many times* it is safe to call it under concurrency - not about payment
 * construction details.
 */
export interface IdempotencyRunContext {
  idempotencyKey: string;
  /** Look up an existing Payment row for this idempotency key, if any. */
  findExisting: () => Promise<PaymentWithLatestTransaction | null>;
  /**
   * Given an existing row, either return it (identical replay) or throw a
   * 409 IDEMPOTENCY_KEY_CONFLICT AppError (payload mismatch). Pure w.r.t.
   * side effects - safe to call multiple times.
   */
  reconcile: (existing: PaymentWithLatestTransaction) => { payment: Payment; transaction: Transaction };
  /**
   * Validates card details (if any) and atomically inserts the new Payment
   * row together with its initial (PENDING) AUTHORIZATION Transaction row.
   * The two are created together specifically so that a concurrent caller
   * reconciling against this row via `reconcile` always finds a transaction
   * to reconcile against, even if it observes the row before the winning
   * caller's gateway call has completed.
   */
  createPayment: () => Promise<{ payment: Payment; transaction: Transaction }>;
}

export interface IdempotencyStrategyResult {
  payment: Payment;
  transaction: Transaction;
  /** true if this resolved to a pre-existing payment (a replay or a race loser reconciling against the winner). */
  isReplay: boolean;
}

/**
 * Governs how PaymentService.createAndAuthorize() ensures at most one
 * Payment row is ever created per idempotency key, even under concurrent
 * duplicate requests. See research/formal-model/idempotency-protocol.md for
 * the safety/liveness argument behind each implementation.
 */
export interface IdempotencyStrategy {
  run(ctx: IdempotencyRunContext): Promise<IdempotencyStrategyResult>;
}

export type IdempotencyStrategyName = 'naive' | 'optimistic' | 'redis-lock';
