import { config } from '../config';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Mock Payment Gateway
 * Simulates responses from a real payment gateway (Stripe, PayPal, etc.)
 */

export interface GatewayAuthorizationRequest {
  amount: number;
  currency: string;
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  cardholderName: string;
}

export interface GatewayResponse {
  success: boolean;
  transactionId: string;
  authorizationCode?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export class PaymentGatewayService {
  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    const latency = config.mockGateway.latencyMs + Math.random() * 50;
    await new Promise((resolve) => setTimeout(resolve, latency));
  }

  /**
   * Simulate success or failure based on configured success rate
   */
  private shouldSucceed(): boolean {
    return Math.random() < config.mockGateway.successRate;
  }

  /**
   * Generate error scenarios
   */
  private generateError(): { code: string; message: string } {
    const errors = [
      { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds in account' },
      { code: 'CARD_DECLINED', message: 'Card was declined by issuing bank' },
      { code: 'INVALID_CARD', message: 'Card number is invalid' },
      { code: 'EXPIRED_CARD', message: 'Card has expired' },
      { code: 'CVV_MISMATCH', message: 'CVV verification failed' },
      { code: 'GATEWAY_ERROR', message: 'Gateway processing error' },
    ];

    return errors[Math.floor(Math.random() * errors.length)];
  }

  /**
   * Authorize a payment
   */
  public async authorize(request: GatewayAuthorizationRequest): Promise<GatewayResponse> {
    logger.info({ amount: request.amount, currency: request.currency }, 'Gateway authorization request');

    await this.simulateLatency();

    if (this.shouldSucceed()) {
      const response: GatewayResponse = {
        success: true,
        transactionId: `gw_${uuidv4()}`,
        authorizationCode: `AUTH_${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        metadata: {
          cardLast4: request.cardNumber.slice(-4),
          cardBrand: this.detectCardBrand(request.cardNumber),
          timestamp: new Date().toISOString(),
        },
      };

      logger.info({ transactionId: response.transactionId }, 'Gateway authorization successful');
      return response;
    } else {
      const error = this.generateError();
      const response: GatewayResponse = {
        success: false,
        transactionId: `gw_${uuidv4()}`,
        errorCode: error.code,
        errorMessage: error.message,
      };

      logger.warn({ errorCode: error.code }, 'Gateway authorization failed');
      return response;
    }
  }

  /**
   * Capture a previously authorized payment
   */
  public async capture(
    transactionId: string,
    amount: number
  ): Promise<GatewayResponse> {
    logger.info({ transactionId, amount }, 'Gateway capture request');

    await this.simulateLatency();

    if (this.shouldSucceed()) {
      const response: GatewayResponse = {
        success: true,
        transactionId: `gw_${uuidv4()}`,
        metadata: {
          originalTransactionId: transactionId,
          capturedAmount: amount,
          timestamp: new Date().toISOString(),
        },
      };

      logger.info({ transactionId: response.transactionId }, 'Gateway capture successful');
      return response;
    } else {
      const error = this.generateError();
      const response: GatewayResponse = {
        success: false,
        transactionId: `gw_${uuidv4()}`,
        errorCode: error.code,
        errorMessage: error.message,
      };

      logger.warn({ errorCode: error.code }, 'Gateway capture failed');
      return response;
    }
  }

  /**
   * Refund a captured payment
   */
  public async refund(
    transactionId: string,
    amount: number
  ): Promise<GatewayResponse> {
    logger.info({ transactionId, amount }, 'Gateway refund request');

    await this.simulateLatency();

    if (this.shouldSucceed()) {
      const response: GatewayResponse = {
        success: true,
        transactionId: `gw_${uuidv4()}`,
        metadata: {
          originalTransactionId: transactionId,
          refundedAmount: amount,
          timestamp: new Date().toISOString(),
        },
      };

      logger.info({ transactionId: response.transactionId }, 'Gateway refund successful');
      return response;
    } else {
      const error = this.generateError();
      const response: GatewayResponse = {
        success: false,
        transactionId: `gw_${uuidv4()}`,
        errorCode: error.code,
        errorMessage: error.message,
      };

      logger.warn({ errorCode: error.code }, 'Gateway refund failed');
      return response;
    }
  }

  /**
   * Reverse/cancel an authorization
   */
  public async reverse(transactionId: string): Promise<GatewayResponse> {
    logger.info({ transactionId }, 'Gateway reversal request');

    await this.simulateLatency();

    if (this.shouldSucceed()) {
      const response: GatewayResponse = {
        success: true,
        transactionId: `gw_${uuidv4()}`,
        metadata: {
          originalTransactionId: transactionId,
          timestamp: new Date().toISOString(),
        },
      };

      logger.info({ transactionId: response.transactionId }, 'Gateway reversal successful');
      return response;
    } else {
      const error = this.generateError();
      const response: GatewayResponse = {
        success: false,
        transactionId: `gw_${uuidv4()}`,
        errorCode: error.code,
        errorMessage: error.message,
      };

      logger.warn({ errorCode: error.code }, 'Gateway reversal failed');
      return response;
    }
  }

  /**
   * Detect card brand from card number
   */
  private detectCardBrand(cardNumber: string): string {
    if (cardNumber.startsWith('4')) {
      return 'VISA';
    } else if (/^5[1-5]/.test(cardNumber)) {
      return 'MASTERCARD';
    } else if (/^3[47]/.test(cardNumber)) {
      return 'AMEX';
    } else if (/^6(?:011|5)/.test(cardNumber)) {
      return 'DISCOVER';
    }
    return 'UNKNOWN';
  }
}

export const paymentGateway = new PaymentGatewayService();
