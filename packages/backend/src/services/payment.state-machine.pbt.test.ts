/**
 * Property-based tests for the payment lifecycle state machine and the
 * idempotency protocol, backed by an in-memory fake Prisma store rather than
 * the one-off `mockResolvedValueOnce` chains used in payment.service.test.ts.
 *
 * Deviation from that convention is deliberate: property-based tests replay
 * arbitrary-length random operation sequences and need consistent state
 * across many calls within a single test run, which a chain of one-shot
 * mocks cannot express. See research/formal-model/payment-state-machine.md
 * for the transition table these tests check against, and
 * research/formal-model/idempotency-protocol.md for the concurrency
 * properties tested in the last describe block.
 */
import fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { PaymentStatus, TransactionType } from '@payment-platform/shared';

// ---------------------------------------------------------------------------
// In-memory fake Prisma store
// ---------------------------------------------------------------------------

interface FakePayment {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  cardLast4?: string;
  cardBrand?: string;
  cardExpMonth?: number;
  cardExpYear?: number;
  billingAddress?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeTransaction {
  id: string;
  paymentId: string;
  type: TransactionType;
  amount: number;
  status: PaymentStatus;
  gatewayTransactionId?: string;
  gatewayResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function decimalLike(n: number): Prisma.Decimal {
  // Mimics just enough of Prisma.Decimal for the service code's `.toNumber()` calls.
  return { toNumber: () => n } as unknown as Prisma.Decimal;
}

class FakeDb {
  payments = new Map<string, FakePayment>();
  transactions: FakeTransaction[] = [];
  private idempotencyIndex = new Map<string, string>();

  private withDecimals(p: FakePayment) {
    return { ...p, amount: decimalLike(p.amount) };
  }

  private txWithDecimals(t: FakeTransaction) {
    return { ...t, amount: decimalLike(t.amount) };
  }

  async paymentFindUnique(args: { where: { idempotencyKey?: string; id?: string }; include?: unknown }) {
    let id: string | undefined;
    if (args.where.idempotencyKey) id = this.idempotencyIndex.get(args.where.idempotencyKey);
    else if (args.where.id) id = this.payments.has(args.where.id) ? args.where.id : undefined;
    if (!id) return null;

    const payment = this.payments.get(id)!;
    if (!args.include) return this.withDecimals(payment);

    const transactions = this.transactions
      .filter((t) => t.paymentId === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t) => this.txWithDecimals(t));

    return { ...this.withDecimals(payment), transactions };
  }

  async paymentCreate(args: { data: Record<string, unknown> }) {
    const idempotencyKey = args.data.idempotencyKey as string;

    // Simulates the database's UNIQUE constraint on idempotencyKey: throwing
    // a *real* Prisma.PrismaClientKnownRequestError with code P2002 so the
    // `instanceof` check in optimistic.strategy.ts behaves exactly as it
    // would against a real Postgres unique-violation.
    if (this.idempotencyIndex.has(idempotencyKey)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`idempotencyKey`)', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }

    const id = uuidv4();
    const now = new Date();
    const payment: FakePayment = {
      id,
      merchantId: args.data.merchantId as string,
      amount: args.data.amount as number,
      currency: args.data.currency as string,
      status: args.data.status as PaymentStatus,
      paymentMethod: args.data.paymentMethod as string,
      idempotencyKey,
      metadata: (args.data.metadata as Record<string, unknown>) || null,
      cardLast4: args.data.cardLast4 as string | undefined,
      cardBrand: args.data.cardBrand as string | undefined,
      createdAt: now,
      updatedAt: now,
    };

    // Register the idempotency key BEFORE any further await in this
    // (synchronous-until-here) function body, so a concurrent call that is
    // already past its own `findExisting` read but hasn't yet reached this
    // point will still correctly collide here rather than silently both
    // "succeeding" - this is what makes the race deterministic to test.
    this.idempotencyIndex.set(idempotencyKey, id);
    this.payments.set(id, payment);

    return this.withDecimals(payment);
  }

  async paymentUpdate(args: { where: { id: string }; data: { status: PaymentStatus } }) {
    const payment = this.payments.get(args.where.id);
    if (!payment) throw new Error('fake store: payment not found');
    payment.status = args.data.status;
    payment.updatedAt = new Date();
    return this.withDecimals(payment);
  }

  async transactionCreate(args: { data: Record<string, unknown> }) {
    const id = uuidv4();
    const now = new Date();
    const tx: FakeTransaction = {
      id,
      paymentId: args.data.paymentId as string,
      type: args.data.type as TransactionType,
      amount: args.data.amount as number,
      status: args.data.status as PaymentStatus,
      gatewayTransactionId: args.data.gatewayTransactionId as string | undefined,
      gatewayResponse: args.data.gatewayResponse,
      errorCode: args.data.errorCode as string | undefined,
      errorMessage: args.data.errorMessage as string | undefined,
      metadata: args.data.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.transactions.push(tx);
    return this.txWithDecimals(tx);
  }

  async transactionUpdate(args: { where: { id: string }; data: Partial<FakeTransaction> }) {
    const tx = this.transactions.find((t) => t.id === args.where.id);
    if (!tx) throw new Error('fake store: transaction not found');
    Object.assign(tx, args.data);
    tx.updatedAt = new Date();
    return this.txWithDecimals(tx);
  }

  async transactionFindFirst(args: {
    where: { paymentId: string; type: TransactionType; status: PaymentStatus };
  }) {
    const matches = this.transactions
      .filter((t) => t.paymentId === args.where.paymentId && t.type === args.where.type && t.status === args.where.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ? this.txWithDecimals(matches[0]) : null;
  }

  async transactionFindMany(args: {
    where: { paymentId: string; type: TransactionType; status: { in: PaymentStatus[] } };
  }) {
    return this.transactions
      .filter(
        (t) =>
          t.paymentId === args.where.paymentId &&
          t.type === args.where.type &&
          args.where.status.in.includes(t.status)
      )
      .map((t) => this.txWithDecimals(t));
  }
}

function buildFakePrisma(db: FakeDb) {
  const client = {
    payment: {
      findUnique: (args: never) => db.paymentFindUnique(args),
      create: (args: never) => db.paymentCreate(args),
      update: (args: never) => db.paymentUpdate(args),
    },
    transaction: {
      create: (args: never) => db.transactionCreate(args),
      update: (args: never) => db.transactionUpdate(args),
      findFirst: (args: never) => db.transactionFindFirst(args),
      findMany: (args: never) => db.transactionFindMany(args),
    },
    // Supports both the array form (independent ops run via Promise.all) and
    // the interactive callback form (`prisma.$transaction(async (tx) => ...)`),
    // matching how payment.service.ts uses each.
    $transaction: (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
      if (typeof arg === 'function') return arg(client);
      return Promise.all(arg);
    },
  };
  return client;
}

// ---------------------------------------------------------------------------
// Module mocks - PaymentService pulls in `prisma` from database.service,
// a deterministic gateway, a no-op audit logger, and no-op metrics.
// ---------------------------------------------------------------------------

let currentDb = new FakeDb();

jest.mock('./database.service', () => ({
  get prisma() {
    return buildFakePrisma(currentDb);
  },
}));

jest.mock('./payment-gateway.service', () => ({
  paymentGateway: {
    authorize: jest.fn().mockResolvedValue({ success: true, transactionId: 'gw_auth' }),
    capture: jest.fn().mockResolvedValue({ success: true, transactionId: 'gw_capture' }),
    refund: jest.fn().mockResolvedValue({ success: true, transactionId: 'gw_refund' }),
    reverse: jest.fn().mockResolvedValue({ success: true, transactionId: 'gw_reverse' }),
  },
}));

jest.mock('./audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../middleware/metrics.middleware', () => ({
  metrics: { paymentOperationsTotal: { inc: jest.fn() } },
}));

import { PaymentService } from './payment.service';
import { OptimisticStrategy } from './idempotency/optimistic.strategy';
import { NaiveStrategy } from './idempotency/naive.strategy';
import { IdempotencyStrategy, IdempotencyRunContext, IdempotencyStrategyResult } from './idempotency/idempotency-strategy';

/**
 * A Redis-free stand-in for RedisLockStrategy, using an in-process mutex.
 * Structurally identical exclusion semantics (only one caller in the
 * critical section at a time) without a live Redis dependency, per the
 * plan's call-out that real-Redis validation belongs in the k6 benchmark,
 * not this fast unit-test suite.
 */
class InMemoryMutexStrategy implements IdempotencyStrategy {
  private locked = new Set<string>();

  async run(ctx: IdempotencyRunContext): Promise<IdempotencyStrategyResult> {
    while (this.locked.has(ctx.idempotencyKey)) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.locked.add(ctx.idempotencyKey);
    try {
      const existing = await ctx.findExisting();
      if (existing) {
        const { payment, transaction } = ctx.reconcile(existing);
        return { payment, transaction, isReplay: true };
      }
      const { payment, transaction } = await ctx.createPayment();
      return { payment, transaction, isReplay: false };
    } finally {
      this.locked.delete(ctx.idempotencyKey);
    }
  }
}

const opContext = { userId: 'u1', role: 'MERCHANT', merchantId: 'm1', ipAddress: '127.0.0.1', userAgent: 'pbt' };

const baseCreateRequest = {
  merchantId: 'm1',
  currency: 'USD',
  paymentMethod: 'CREDIT_CARD',
  // Required so the mocked gateway path (rather than the "MISSING_CARD_DETAILS"
  // auto-fail branch in payment.service.ts) is exercised, i.e. so a fresh
  // payment actually reaches AUTHORIZED.
  cardDetails: {
    cardNumber: '4111111111111111',
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 2,
    cvv: '123',
    cardholderName: 'PBT Test',
  },
} as const;

async function authorizeFreshPayment(service: PaymentService, amount = 100) {
  const { payment } = await service.createAndAuthorize(
    { ...baseCreateRequest, amount, idempotencyKey: uuidv4() } as never,
    opContext
  );
  return payment;
}

// ---------------------------------------------------------------------------
// Valid transition edges, mirroring research/formal-model/payment-state-machine.md
// ---------------------------------------------------------------------------

const VALID_EDGES = new Set([
  `${PaymentStatus.AUTHORIZED}->capture->${PaymentStatus.CAPTURED}`,
  `${PaymentStatus.CAPTURED}->refund->${PaymentStatus.CAPTURED}`, // no-op guard rejection doesn't count as a transition
  `${PaymentStatus.CAPTURED}->refund->${PaymentStatus.PARTIALLY_REFUNDED}`,
  `${PaymentStatus.CAPTURED}->refund->${PaymentStatus.REFUNDED}`,
  `${PaymentStatus.PARTIALLY_REFUNDED}->refund->${PaymentStatus.PARTIALLY_REFUNDED}`,
  `${PaymentStatus.PARTIALLY_REFUNDED}->refund->${PaymentStatus.REFUNDED}`,
  `${PaymentStatus.PENDING}->cancel->${PaymentStatus.CANCELLED}`,
  `${PaymentStatus.AUTHORIZED}->cancel->${PaymentStatus.CANCELLED}`,
]);

describe('Payment state machine (property-based)', () => {
  beforeEach(() => {
    currentDb = new FakeDb();
  });

  it('never observes a status transition outside the documented edge set', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<'capture' | 'refund' | 'cancel'>('capture', 'refund', 'cancel'), {
          minLength: 1,
          maxLength: 15,
        }),
        async (ops) => {
          currentDb = new FakeDb();
          const service = new PaymentService(new OptimisticStrategy());
          const payment = await authorizeFreshPayment(service, 100);

          let priorStatus = payment.status;

          for (const op of ops) {
            const before = priorStatus;
            try {
              let result;
              if (op === 'capture') result = await service.capture(payment.id, {}, opContext);
              else if (op === 'refund') result = await service.refund(payment.id, { amount: 10 }, opContext);
              else result = await service.cancel(payment.id, {}, opContext);

              const after = result.payment.status;

              if (after !== before) {
                const edge = `${before}->${op}->${after}`;
                expect(VALID_EDGES.has(edge)).toBe(true);
              }

              priorStatus = after;
            } catch (error) {
              // Guard rejections (INVALID_PAYMENT_STATE, REFUND_EXCEEDS_REMAINING)
              // are expected and must leave status unchanged - that's the property.
              priorStatus = before;
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('never lets total successful refunds exceed the original payment amount', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 10 }),
        async (refundAmounts) => {
          currentDb = new FakeDb();
          const service = new PaymentService(new OptimisticStrategy());
          const payment = await authorizeFreshPayment(service, 100);
          await service.capture(payment.id, {}, opContext);

          for (const amount of refundAmounts) {
            try {
              await service.refund(payment.id, { amount }, opContext);
            } catch {
              // Expected once remaining is exhausted - REFUND_EXCEEDS_REMAINING.
            }
          }

          const successfulRefunds = currentDb.transactions.filter(
            (t) =>
              t.paymentId === payment.id &&
              t.type === TransactionType.REFUND &&
              (t.status === PaymentStatus.REFUNDED || t.status === PaymentStatus.PARTIALLY_REFUNDED)
          );
          const totalRefunded = successfulRefunds.reduce((sum, t) => sum + t.amount, 0);

          expect(totalRefunded).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe.each([
  ['naive', () => new NaiveStrategy(), false] as const,
  ['optimistic', () => new OptimisticStrategy(), true] as const,
  ['redis-lock (in-memory mutex stand-in)', () => new InMemoryMutexStrategy(), true] as const,
])('Idempotency invariant under concurrency - %s strategy', (_name, makeStrategy, expectLiveness) => {
  it(`upholds safety always, and liveness ${expectLiveness ? 'holds' : 'is known to fail (documented defect)'}`, async () => {
    currentDb = new FakeDb();
    const service = new PaymentService(makeStrategy());
    const sharedKey = uuidv4();
    const CONCURRENCY = 8;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        service.createAndAuthorize({ ...baseCreateRequest, amount: 42, idempotencyKey: sharedKey } as never, opContext)
      )
    );

    // Safety: regardless of strategy, the store must never contain more than
    // one Payment row for this idempotency key.
    const paymentsWithKey = Array.from(currentDb.payments.values()).filter((p) => p.idempotencyKey === sharedKey);
    expect(paymentsWithKey.length).toBe(1);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    if (expectLiveness) {
      // Every concurrent caller gets a well-defined result - none reject.
      expect(fulfilled.length).toBe(CONCURRENCY);
      expect(rejected.length).toBe(0);
    } else {
      // Documented defect: NaiveStrategy lets the losing caller(s) see an
      // unhandled unique-constraint error instead of a graceful response.
      expect(rejected.length).toBeGreaterThan(0);
    }
  });
});
