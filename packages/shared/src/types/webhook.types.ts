import { z } from 'zod';
import { PaymentStatus, TransactionType } from './payment.types';

// Webhook Event Types
export enum WebhookEventType {
  PAYMENT_AUTHORIZED = 'payment.authorized',
  PAYMENT_CAPTURED = 'payment.captured',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',
  PAYMENT_CANCELLED = 'payment.cancelled',
}

// Webhook Status
export enum WebhookStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  RETRY = 'RETRY',
}

// Webhook Event Schema
export const WebhookEventSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(WebhookEventType),
  timestamp: z.string().datetime(),
  data: z.object({
    paymentId: z.string().uuid(),
    merchantId: z.string().uuid(),
    transactionId: z.string().uuid(),
    amount: z.number(),
    currency: z.string(),
    status: z.nativeEnum(PaymentStatus),
    transactionType: z.nativeEnum(TransactionType),
    metadata: z.record(z.string()).optional(),
  }),
});

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.nativeEnum(WebhookEventType)),
  secret: z.string().optional(),
  active: z.boolean().default(true),
  metadata: z.record(z.string()).optional(),
});

// TypeScript types
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  url: string;
  status: WebhookStatus;
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  responseStatus?: number;
  responseBody?: string;
  createdAt: Date;
}
