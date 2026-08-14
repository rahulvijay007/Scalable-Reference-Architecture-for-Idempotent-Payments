import {
  CreatePaymentRequest,
  CancelPaymentRequest,
  PaymentStatus,
  TransactionType,
  hashData,
  maskCardNumber,
  validateCardNumber,
  validateExpiryDate,
  validateCvv,
  detectCardType,
} from '@payment-platform/shared';
import { Payment, Transaction, Prisma } from '@prisma/client';
import { prisma } from './database.service';
import { paymentGateway } from './payment-gateway.service';
import { auditService } from './audit.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { metrics } from '../middleware/metrics.middleware';
import { config } from '../config';
import { createIdempotencyStrategy, IdempotencyStrategy, PaymentWithLatestTransaction } from './idempotency';

interface OperationContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface CaptureData {
  amount?: number;
  metadata?: Record<string, string>;
}

interface RefundData {
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

interface ListParams {
  merchantId?: string;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Build a canonical hash of the parts of a payment request that must stay
 * identical across idempotency-key retries. Used to detect a caller reusing
 * the same idempotencyKey with a different payload.
 */
function hashIdempotentRequest(data: CreatePaymentRequest): string {
  const canonical = JSON.stringify({
    merchantId: data.merchantId,
    amount: data.amount,
    currency: data.currency,
    paymentMethod: data.paymentMethod,
  });
  return hashData(canonical);
}

function assertMerchantAccess(
  payment: { merchantId: string },
  requestingUser: { userId: string; role: string; merchantId?: string }
): void {
  if (requestingUser.role === 'ADMIN') {
    return;
  }

  if (payment.merchantId !== requestingUser.merchantId) {
    throw new AppError(403, 'MERCHANT_ACCESS_DENIED', 'You do not have access to this payment');
  }
}

export class PaymentService {
  constructor(
    private readonly idempotencyStrategy: IdempotencyStrategy = createIdempotencyStrategy(config.idempotency.strategy)
  ) {}

  /**
   * Create a payment and immediately attempt authorization against the gateway.
   * Enforces idempotency: a repeated idempotencyKey with an identical payload
   * returns the original result; a repeated key with a different payload conflicts.
   *
   * Uniqueness of the created Payment row per idempotencyKey is delegated to
   * `this.idempotencyStrategy` (see services/idempotency/) - see
   * research/formal-model/idempotency-protocol.md for the correctness argument.
   */
  public async createAndAuthorize(
    data: CreatePaymentRequest,
    context: OperationContext
  ): Promise<{ payment: Payment; transaction: Transaction }> {
    const requestHash = hashIdempotentRequest(data);

    const findExisting = (): Promise<PaymentWithLatestTransaction | null> =>
      prisma.payment.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
        include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

    const reconcile = (existing: PaymentWithLatestTransaction): { payment: Payment; transaction: Transaction } => {
      const existingMetadata = (existing.metadata as Record<string, unknown> | null) || {};

      if (existingMetadata._requestHash !== requestHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
          'This idempotency key was already used with a different request payload'
        );
      }

      logger.info({ paymentId: existing.id }, 'Idempotent replay: returning existing payment');

      const transaction = existing.transactions[0];
      if (!transaction) {
        throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Existing payment has no transaction record');
      }

      return { payment: existing, transaction };
    };

    // Validates card details (if any) and inserts the new Payment row. Called
    // at most once per request by every strategy - lazily, only once the
    // strategy has decided a fresh insert is actually needed - so validation
    // never runs on an idempotent replay.
    const createPayment = (): Promise<{ payment: Payment; transaction: Transaction }> => {
      let cardLast4: string | undefined;
      let cardBrand: string | undefined;

      if (data.cardDetails) {
        const { cardNumber, expiryMonth, expiryYear, cvv } = data.cardDetails;

        if (!validateCardNumber(cardNumber)) {
          throw new AppError(400, 'INVALID_CARD', 'Card number failed validation');
        }

        if (!validateExpiryDate(expiryMonth, expiryYear)) {
          throw new AppError(400, 'INVALID_CARD', 'Card expiry date is invalid or in the past');
        }

        const cardType = data.cardDetails.cardType || detectCardType(cardNumber);

        if (!validateCvv(cvv, cardType)) {
          throw new AppError(400, 'INVALID_CARD', 'CVV is invalid for this card type');
        }

        cardLast4 = maskCardNumber(cardNumber).slice(-4);
        cardBrand = cardType;
      }

      // Payment and its initial (PENDING) AUTHORIZATION Transaction are
      // created together, atomically, in the same DB transaction. This is
      // essential for the idempotency protocol's correctness: a concurrent
      // request that loses the race and reconciles against this row (see
      // OptimisticStrategy/RedisLockStrategy) must always find a
      // transaction to reconcile against - if the Transaction were created
      // later (e.g. only after the gateway call below), a racing reconciler
      // could observe the Payment row but no Transaction yet and fail with
      // a spurious 500. This was caught empirically by the property-based
      // concurrency test in payment.state-machine.pbt.test.ts.
      return prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            merchantId: data.merchantId,
            amount: data.amount,
            currency: data.currency,
            status: PaymentStatus.PENDING,
            paymentMethod: data.paymentMethod,
            cardLast4,
            cardBrand,
            cardExpMonth: data.cardDetails?.expiryMonth,
            cardExpYear: data.cardDetails?.expiryYear,
            billingAddress: data.billingAddress as unknown as Prisma.InputJsonValue,
            idempotencyKey: data.idempotencyKey,
            metadata: { ...(data.metadata || {}), _requestHash: requestHash } as Prisma.InputJsonValue,
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            paymentId: payment.id,
            type: TransactionType.AUTHORIZATION,
            amount: data.amount,
            status: PaymentStatus.PENDING,
          },
        });

        return { payment, transaction };
      });
    };

    const result = await this.idempotencyStrategy.run({
      idempotencyKey: data.idempotencyKey,
      findExisting,
      reconcile,
      createPayment,
    });

    if (result.isReplay) {
      // Resolved to a pre-existing payment (identical replay) - skip the
      // gateway call entirely, nothing new to authorize.
      return { payment: result.payment, transaction: result.transaction };
    }

    const payment = result.payment;
    const authorizationTransactionId = result.transaction.id;

    const gatewayResponse = data.cardDetails
      ? await paymentGateway.authorize({
          amount: data.amount,
          currency: data.currency,
          cardNumber: data.cardDetails.cardNumber,
          expiryMonth: data.cardDetails.expiryMonth,
          expiryYear: data.cardDetails.expiryYear,
          cvv: data.cardDetails.cvv,
          cardholderName: data.cardDetails.cardholderName,
        })
      : { success: false, transactionId: '', errorCode: 'MISSING_CARD_DETAILS', errorMessage: 'Card details are required to authorize a payment' };

    const newStatus = gatewayResponse.success ? PaymentStatus.AUTHORIZED : PaymentStatus.FAILED;

    const [updatedPayment, transaction] = await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus },
      }),
      prisma.transaction.update({
        where: { id: authorizationTransactionId },
        data: {
          status: newStatus,
          gatewayTransactionId: gatewayResponse.transactionId || undefined,
          gatewayResponse: gatewayResponse as unknown as Prisma.InputJsonValue,
          errorCode: gatewayResponse.errorCode,
          errorMessage: gatewayResponse.errorMessage,
        },
      }),
    ]);

    metrics.paymentOperationsTotal.inc({
      operation: 'authorize',
      status: gatewayResponse.success ? 'success' : 'failure',
    });

    await auditService.log({
      userId: context.userId,
      action: 'PAYMENT_CREATED',
      resource: 'Payment',
      resourceId: payment.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: { amount: data.amount, currency: data.currency, status: newStatus },
    });

    return { payment: updatedPayment, transaction };
  }

  public async capture(
    paymentId: string,
    data: CaptureData,
    context: OperationContext & { role: string; merchantId?: string }
  ): Promise<{ payment: Payment; transaction: Transaction }> {
    const payment = await this.loadPaymentOrThrow(paymentId);
    assertMerchantAccess(payment, { userId: context.userId, role: context.role, merchantId: context.merchantId });

    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new AppError(409, 'INVALID_PAYMENT_STATE', 'Payment must be authorized to capture');
    }

    const authTransaction = await prisma.transaction.findFirst({
      where: { paymentId, type: TransactionType.AUTHORIZATION, status: PaymentStatus.AUTHORIZED },
      orderBy: { createdAt: 'desc' },
    });

    if (!authTransaction?.gatewayTransactionId) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'No prior authorization found for this payment');
    }

    const captureAmount = data.amount ?? payment.amount.toNumber();
    const gatewayResponse = await paymentGateway.capture(authTransaction.gatewayTransactionId, captureAmount);

    const newStatus = gatewayResponse.success ? PaymentStatus.CAPTURED : payment.status;

    const [updatedPayment, transaction] = await prisma.$transaction([
      prisma.payment.update({ where: { id: paymentId }, data: { status: newStatus } }),
      prisma.transaction.create({
        data: {
          paymentId,
          type: TransactionType.CAPTURE,
          amount: captureAmount,
          status: gatewayResponse.success ? PaymentStatus.CAPTURED : PaymentStatus.FAILED,
          gatewayTransactionId: gatewayResponse.transactionId || undefined,
          gatewayResponse: gatewayResponse as unknown as Prisma.InputJsonValue,
          errorCode: gatewayResponse.errorCode,
          errorMessage: gatewayResponse.errorMessage,
          metadata: data.metadata as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    metrics.paymentOperationsTotal.inc({
      operation: 'capture',
      status: gatewayResponse.success ? 'success' : 'failure',
    });

    if (!gatewayResponse.success) {
      throw new AppError(502, 'GATEWAY_ERROR', gatewayResponse.errorMessage || 'Capture failed at the gateway');
    }

    await auditService.log({
      userId: context.userId,
      action: 'PAYMENT_CAPTURED',
      resource: 'Payment',
      resourceId: paymentId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: { amount: captureAmount },
    });

    return { payment: updatedPayment, transaction };
  }

  public async refund(
    paymentId: string,
    data: RefundData,
    context: OperationContext & { role: string; merchantId?: string }
  ): Promise<{ payment: Payment; transaction: Transaction }> {
    const payment = await this.loadPaymentOrThrow(paymentId);
    assertMerchantAccess(payment, { userId: context.userId, role: context.role, merchantId: context.merchantId });

    if (payment.status !== PaymentStatus.CAPTURED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new AppError(409, 'INVALID_PAYMENT_STATE', 'Payment must be captured to refund');
    }

    const priorRefunds = await prisma.transaction.findMany({
      where: { paymentId, type: TransactionType.REFUND, status: { in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] } },
    });

    const totalRefunded = priorRefunds.reduce((sum, t) => sum + t.amount.toNumber(), 0);
    const totalAmount = payment.amount.toNumber();
    const remaining = totalAmount - totalRefunded;

    const refundAmount = data.amount ?? remaining;

    if (refundAmount > remaining) {
      throw new AppError(400, 'REFUND_EXCEEDS_REMAINING', `Refund amount exceeds remaining refundable amount of ${remaining}`);
    }

    const captureTransaction = await prisma.transaction.findFirst({
      where: { paymentId, type: TransactionType.CAPTURE, status: PaymentStatus.CAPTURED },
      orderBy: { createdAt: 'desc' },
    });

    if (!captureTransaction?.gatewayTransactionId) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'No prior capture found for this payment');
    }

    const gatewayResponse = await paymentGateway.refund(captureTransaction.gatewayTransactionId, refundAmount);

    const isFullyRefunded = gatewayResponse.success && totalRefunded + refundAmount >= totalAmount;
    const newStatus = gatewayResponse.success
      ? isFullyRefunded
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED
      : payment.status;

    const [updatedPayment, transaction] = await prisma.$transaction([
      prisma.payment.update({ where: { id: paymentId }, data: { status: newStatus } }),
      prisma.transaction.create({
        data: {
          paymentId,
          type: TransactionType.REFUND,
          amount: refundAmount,
          status: gatewayResponse.success ? newStatus : PaymentStatus.FAILED,
          gatewayTransactionId: gatewayResponse.transactionId || undefined,
          gatewayResponse: gatewayResponse as unknown as Prisma.InputJsonValue,
          errorCode: gatewayResponse.errorCode,
          errorMessage: gatewayResponse.errorMessage,
          metadata: { ...(data.metadata || {}), reason: data.reason } as Prisma.InputJsonValue,
        },
      }),
    ]);

    metrics.paymentOperationsTotal.inc({
      operation: 'refund',
      status: gatewayResponse.success ? 'success' : 'failure',
    });

    if (!gatewayResponse.success) {
      throw new AppError(502, 'GATEWAY_ERROR', gatewayResponse.errorMessage || 'Refund failed at the gateway');
    }

    await auditService.log({
      userId: context.userId,
      action: 'PAYMENT_REFUNDED',
      resource: 'Payment',
      resourceId: paymentId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: { amount: refundAmount, reason: data.reason },
    });

    return { payment: updatedPayment, transaction };
  }

  public async cancel(
    paymentId: string,
    data: CancelPaymentRequest,
    context: OperationContext & { role: string; merchantId?: string }
  ): Promise<{ payment: Payment; transaction: Transaction }> {
    const payment = await this.loadPaymentOrThrow(paymentId);
    assertMerchantAccess(payment, { userId: context.userId, role: context.role, merchantId: context.merchantId });

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.AUTHORIZED) {
      throw new AppError(409, 'INVALID_PAYMENT_STATE', 'Only pending or authorized payments can be cancelled');
    }

    const authTransaction = await prisma.transaction.findFirst({
      where: { paymentId, type: TransactionType.AUTHORIZATION, status: PaymentStatus.AUTHORIZED },
      orderBy: { createdAt: 'desc' },
    });

    const gatewayResponse = authTransaction?.gatewayTransactionId
      ? await paymentGateway.reverse(authTransaction.gatewayTransactionId)
      : { success: true, transactionId: '' };

    const newStatus = gatewayResponse.success ? PaymentStatus.CANCELLED : payment.status;

    const [updatedPayment, transaction] = await prisma.$transaction([
      prisma.payment.update({ where: { id: paymentId }, data: { status: newStatus } }),
      prisma.transaction.create({
        data: {
          paymentId,
          type: TransactionType.REVERSAL,
          amount: payment.amount,
          status: gatewayResponse.success ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
          gatewayTransactionId: gatewayResponse.transactionId || undefined,
          gatewayResponse: gatewayResponse as unknown as Prisma.InputJsonValue,
          errorCode: 'errorCode' in gatewayResponse ? gatewayResponse.errorCode : undefined,
          errorMessage: 'errorMessage' in gatewayResponse ? gatewayResponse.errorMessage : undefined,
          metadata: { ...(data.metadata || {}), reason: data.reason } as Prisma.InputJsonValue,
        },
      }),
    ]);

    metrics.paymentOperationsTotal.inc({
      operation: 'cancel',
      status: gatewayResponse.success ? 'success' : 'failure',
    });

    if (!gatewayResponse.success) {
      const message = ('errorMessage' in gatewayResponse && gatewayResponse.errorMessage) || 'Cancellation failed at the gateway';
      throw new AppError(502, 'GATEWAY_ERROR', message);
    }

    await auditService.log({
      userId: context.userId,
      action: 'PAYMENT_CANCELLED',
      resource: 'Payment',
      resourceId: paymentId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details: { reason: data.reason },
    });

    return { payment: updatedPayment, transaction };
  }

  public async getById(paymentId: string, requestingUser: { userId: string; role: string; merchantId?: string }) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { transactions: { orderBy: { createdAt: 'asc' } } },
    });

    if (!payment) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    assertMerchantAccess(payment, requestingUser);

    return payment;
  }

  public async list(params: ListParams) {
    const page = params.page || 1;
    const limit = params.limit || 25;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {};

    if (params.merchantId) {
      where.merchantId = params.merchantId;
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) where.createdAt.gte = params.startDate;
      if (params.endDate) where.createdAt.lte = params.endDate;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      payments,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async loadPaymentOrThrow(paymentId: string): Promise<Payment> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

    if (!payment) {
      throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    return payment;
  }
}

export const paymentService = new PaymentService();
