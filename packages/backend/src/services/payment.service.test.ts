import { PaymentStatus } from '@payment-platform/shared';

jest.mock('./database.service', () => {
  const prisma: Record<string, unknown> = {
    payment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    // Supports both the array form (Promise.all) and the interactive
    // callback form `prisma.$transaction(async (tx) => ...)` - PaymentService
    // uses the latter for the atomic Payment+Transaction creation.
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[])
    ),
  };
  return { prisma };
});

jest.mock('./payment-gateway.service', () => ({
  paymentGateway: {
    authorize: jest.fn(),
    capture: jest.fn(),
    refund: jest.fn(),
    reverse: jest.fn(),
  },
}));

jest.mock('./audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../middleware/metrics.middleware', () => ({
  metrics: { paymentOperationsTotal: { inc: jest.fn() } },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('./database.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { paymentGateway } = require('./payment-gateway.service');
import { paymentService } from './payment.service';

const decimal = (n: number) => ({ toNumber: () => n });

const context = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'jest' };
const opContext = { ...context, role: 'MERCHANT', merchantId: 'merchant-1' };

const validCardDetails = {
  cardNumber: '4111111111111111',
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 2,
  cvv: '123',
  cardholderName: 'Test User',
};

describe('PaymentService.createAndAuthorize', () => {
  it('returns the existing payment without calling the gateway on an identical idempotent replay', async () => {
    const existingPayment = {
      id: 'payment-1',
      merchantId: 'merchant-1',
      metadata: { _requestHash: expect.any(String) },
      transactions: [{ id: 'txn-1' }],
    };

    // First compute the hash the service would generate, so the "existing" record matches it
    const data = {
      merchantId: 'merchant-1',
      amount: 100,
      currency: 'USD',
      paymentMethod: 'CREDIT_CARD',
      cardDetails: validCardDetails,
      idempotencyKey: 'idem-1',
    } as never;

    // First call: no existing payment, atomically creates a fresh Payment +
    // placeholder AUTHORIZATION Transaction, then updates both after the
    // (mocked) gateway call succeeds.
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    prisma.payment.create.mockResolvedValueOnce({ id: 'payment-1', metadata: {} });
    prisma.transaction.create.mockResolvedValueOnce({ id: 'txn-1', status: PaymentStatus.PENDING });
    paymentGateway.authorize.mockResolvedValueOnce({ success: true, transactionId: 'gw_1' });
    prisma.payment.update.mockResolvedValueOnce({ id: 'payment-1', status: PaymentStatus.AUTHORIZED });
    prisma.transaction.update.mockResolvedValueOnce({ id: 'txn-1', status: PaymentStatus.AUTHORIZED });

    const first = await paymentService.createAndAuthorize(data, context);
    const requestHash = (prisma.payment.create.mock.calls[0][0].data.metadata as { _requestHash: string })._requestHash;

    // Second call with the same idempotencyKey and payload: service should short-circuit
    prisma.payment.findUnique.mockResolvedValueOnce({
      ...existingPayment,
      metadata: { _requestHash: requestHash },
    });

    const second = await paymentService.createAndAuthorize(data, context);

    expect(second.payment.id).toBe(first.payment.id);
    expect(paymentGateway.authorize).toHaveBeenCalledTimes(1); // not called again on replay
  });

  it('throws IDEMPOTENCY_KEY_CONFLICT when the same key is reused with a different payload', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-1',
      metadata: { _requestHash: 'some-other-hash' },
      transactions: [{ id: 'txn-1' }],
    });

    await expect(
      paymentService.createAndAuthorize(
        {
          merchantId: 'merchant-1',
          amount: 999,
          currency: 'USD',
          paymentMethod: 'CREDIT_CARD',
          idempotencyKey: 'idem-1',
        } as never,
        context
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('rejects an invalid card number before ever calling the gateway', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    await expect(
      paymentService.createAndAuthorize(
        {
          merchantId: 'merchant-1',
          amount: 100,
          currency: 'USD',
          paymentMethod: 'CREDIT_CARD',
          cardDetails: { ...validCardDetails, cardNumber: '4111111111111112' }, // fails Luhn
          idempotencyKey: 'idem-2',
        } as never,
        context
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CARD' });

    expect(paymentGateway.authorize).not.toHaveBeenCalled();
  });
});

describe('PaymentService.capture', () => {
  it('throws INVALID_PAYMENT_STATE when the payment is not AUTHORIZED', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-1',
      merchantId: 'merchant-1',
      status: PaymentStatus.PENDING,
      amount: decimal(100),
    });

    await expect(paymentService.capture('payment-1', {}, opContext)).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_PAYMENT_STATE',
    });
  });

  it('throws PAYMENT_NOT_FOUND for a missing payment', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce(null);

    await expect(paymentService.capture('missing', {}, opContext)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });
});

describe('PaymentService.refund', () => {
  it('throws REFUND_EXCEEDS_REMAINING when the requested amount exceeds what is refundable', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({
      id: 'payment-1',
      merchantId: 'merchant-1',
      status: PaymentStatus.CAPTURED,
      amount: decimal(100),
    });
    prisma.transaction.findMany.mockResolvedValueOnce([]); // no prior refunds

    await expect(
      paymentService.refund('payment-1', { amount: 150 }, opContext)
    ).rejects.toMatchObject({ statusCode: 400, code: 'REFUND_EXCEEDS_REMAINING' });
  });
});
