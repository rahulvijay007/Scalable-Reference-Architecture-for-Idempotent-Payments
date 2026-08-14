import { PaymentStatus, TransactionType, Currency, PaymentMethod } from '@payment-platform/shared';

/**
 * Shapes of the raw JSON the backend actually returns for payments/transactions
 * (Prisma models serialized via ApiResponse<T>). Decimal fields arrive as
 * strings over JSON, not numbers, so these are declared separately from
 * @payment-platform/shared's PaymentResponse/TransactionResponse, which model
 * the *intended* API rather than the current Prisma passthrough.
 */
export interface Transaction {
  id: string;
  paymentId: string;
  type: TransactionType;
  amount: string;
  status: PaymentStatus;
  gatewayTransactionId?: string | null;
  gatewayResponse?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  merchantId: string;
  amount: string;
  currency: Currency;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardExpMonth?: number | null;
  cardExpYear?: number | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
  transactions?: Transaction[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentWithTransaction extends Payment {
  transaction: Transaction;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiKey {
  id: string;
  key: string; // raw key only on creation response; masked thereafter
  name: string;
  merchantId: string;
  permissions: string[];
  lastUsedAt?: string | null;
  isActive: boolean;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
