import { z } from 'zod';

// Payment Status
export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

// Transaction Type
export enum TransactionType {
  AUTHORIZATION = 'AUTHORIZATION',
  CAPTURE = 'CAPTURE',
  REFUND = 'REFUND',
  REVERSAL = 'REVERSAL',
}

// Currency codes (ISO 4217)
export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  JPY = 'JPY',
  INR = 'INR',
}

// Payment Method
export enum PaymentMethod {
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  DIGITAL_WALLET = 'DIGITAL_WALLET',
}

// Card Type
export enum CardType {
  VISA = 'VISA',
  MASTERCARD = 'MASTERCARD',
  AMEX = 'AMEX',
  DISCOVER = 'DISCOVER',
}

// Zod Schemas for validation
export const CreatePaymentSchema = z.object({
  merchantId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency),
  paymentMethod: z.nativeEnum(PaymentMethod),
  cardDetails: z
    .object({
      cardNumber: z.string().regex(/^\d{13,19}$/),
      expiryMonth: z.number().min(1).max(12),
      expiryYear: z.number().min(new Date().getFullYear()),
      cvv: z.string().regex(/^\d{3,4}$/),
      cardholderName: z.string().min(1),
      cardType: z.nativeEnum(CardType).optional(),
    })
    .optional(),
  billingAddress: z
    .object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      country: z.string().length(2),
    })
    .optional(),
  metadata: z.record(z.string()).optional(),
  idempotencyKey: z.string().uuid(),
});

export const CapturePaymentSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
  metadata: z.record(z.string()).optional(),
});

export const RefundPaymentSchema = z.object({
  transactionId: z.string().uuid(),
  amount: z.number().positive().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

export const CancelPaymentSchema = z.object({
  reason: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

// TypeScript types inferred from Zod schemas
export type CreatePaymentRequest = z.infer<typeof CreatePaymentSchema>;
export type CapturePaymentRequest = z.infer<typeof CapturePaymentSchema>;
export type RefundPaymentRequest = z.infer<typeof RefundPaymentSchema>;
export type CancelPaymentRequest = z.infer<typeof CancelPaymentSchema>;

// Response types
export interface PaymentResponse {
  id: string;
  merchantId: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, string>;
}

export interface TransactionResponse {
  id: string;
  paymentId: string;
  type: TransactionType;
  amount: number;
  status: PaymentStatus;
  createdAt: Date;
  metadata?: Record<string, string>;
}
