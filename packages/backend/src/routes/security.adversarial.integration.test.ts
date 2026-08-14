import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { createApp } from '../app';
import { config } from '../config';
import { UserRole } from '@payment-platform/shared';

/**
 * Adversarial security tests exercising the threat model in
 * research/security/threat-model.md against a real Postgres instance.
 * Same preconditions as payment.routes.integration.test.ts:
 *   docker compose up -d postgres
 *   pnpm prisma:migrate && pnpm prisma:seed
 */
const app = createApp();

const MERCHANT_A_CREDENTIALS = { email: 'merchant@payment-platform.com', password: 'Merchant@123456' };

const VALID_CARD = {
  cardNumber: '4111111111111111',
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 2,
  cvv: '123',
  cardholderName: 'Adversarial Test',
};

async function loginAs(credentials: { email: string; password: string }) {
  const res = await request(app).post('/api/auth/login').send(credentials);
  if (res.status !== 200) {
    throw new Error(`Login failed for ${credentials.email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { accessToken: string; user: { merchantId?: string; userId?: string } };
}

async function registerMerchantUser() {
  const email = `adv-merchant-${randomUUID()}@payment-platform.com`;
  const res = await request(app).post('/api/auth/register').send({
    email,
    password: 'Password@123456',
    firstName: 'Adversarial',
    lastName: 'Merchant',
  });
  if (res.status !== 201) {
    throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { accessToken: string; user: { merchantId?: string } };
}

describe('Adversarial security tests', () => {
  let merchantAToken: string;
  let merchantAId: string;

  beforeAll(async () => {
    const session = await loginAs(MERCHANT_A_CREDENTIALS);
    merchantAToken = session.accessToken;
    merchantAId = session.user.merchantId as string;
  });

  describe('JWT tampering', () => {
    it('rejects an expired access token', async () => {
      const payload = {
        userId: 'attacker',
        email: 'attacker@example.com',
        role: UserRole.ADMIN,
        permissions: [],
      };
      const expiredToken = jwt.sign(payload, config.jwt.secret, { expiresIn: -1 });

      const res = await request(app).get('/api/payments').set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects a token signed with the wrong secret (forged token)', async () => {
      const payload = {
        userId: 'attacker',
        email: 'attacker@example.com',
        role: UserRole.ADMIN,
        permissions: [],
      };
      const forgedToken = jwt.sign(payload, 'not-the-real-secret', { expiresIn: '15m' });

      const res = await request(app).get('/api/payments').set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('HMAC signature verification', () => {
    // config.hmac.enabled is read once at module load, so we exercise this
    // path with a freshly-required app under HMAC_VERIFICATION_ENABLED=true
    // rather than mutating the already-loaded `config` singleton in place.
    //
    // Path note: /api/payments is mounted via
    // `app.use('/api/payments', authenticateAny, conditionalHmac, paymentRoutes)`.
    // Express strips the matched mount prefix from req.url for every
    // middleware registered at that mount point, not just the sub-router -
    // so inside verifyHmac, req.path for `GET /api/payments` is actually
    // `/`, not `/api/payments`. Signatures below are computed against that
    // stripped path to match what the server actually verifies against.
    it('rejects a tampered HMAC signature when signing is enabled', async () => {
      const originalEnv = process.env.HMAC_VERIFICATION_ENABLED;
      process.env.HMAC_VERIFICATION_ENABLED = 'true';

      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createApp: createHmacApp } = require('../app');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createHmacSignature } = require('../middleware/hmac.middleware');
      const hmacApp = createHmacApp();

      try {
        // Sign with an explicit empty-object body and send the same
        // explicit empty-object body, so what's signed matches exactly
        // what verifyHmac recomputes server-side from req.body.
        const { signature, timestamp } = createHmacSignature('GET', '/', {});

        const res = await request(hmacApp)
          .get('/api/payments')
          .send({})
          .set('Authorization', `Bearer ${merchantAToken}`)
          .set('X-Signature', `${signature}tampered`)
          .set('X-Timestamp', timestamp);

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      } finally {
        process.env.HMAC_VERIFICATION_ENABLED = originalEnv;
        jest.resetModules();
      }
    });

    it('DOCUMENTS a known limitation: a valid signature can be replayed within the freshness window', async () => {
      const originalEnv = process.env.HMAC_VERIFICATION_ENABLED;
      process.env.HMAC_VERIFICATION_ENABLED = 'true';

      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createApp: createHmacApp } = require('../app');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createHmacSignature } = require('../middleware/hmac.middleware');
      const hmacApp = createHmacApp();

      try {
        const { signature, timestamp } = createHmacSignature('GET', '/', {});

        const first = await request(hmacApp)
          .get('/api/payments')
          .send({})
          .set('Authorization', `Bearer ${merchantAToken}`)
          .set('X-Signature', signature)
          .set('X-Timestamp', timestamp);

        // Sanity check: the freshly-computed signature must actually be
        // accepted first, or the "replay also succeeds" assertion below
        // would be vacuously true for the wrong reason.
        expect(first.status).not.toBe(401);

        const replay = await request(hmacApp)
          .get('/api/payments')
          .send({})
          .set('Authorization', `Bearer ${merchantAToken}`)
          .set('X-Signature', signature)
          .set('X-Timestamp', timestamp);

        // This SUCCEEDING (not 401) is the documented gap in
        // research/security/threat-model.md - there is no nonce/used-signature
        // tracking, so a captured valid request can be replayed verbatim
        // within the timestamp freshness window. Asserted explicitly here
        // so a future fix is expected to change this test, not break it
        // silently.
        expect(replay.status).toBe(first.status);
        expect(replay.status).not.toBe(401);
      } finally {
        process.env.HMAC_VERIFICATION_ENABLED = originalEnv;
        jest.resetModules();
      }
    });
  });

  describe('Cross-merchant access', () => {
    it('denies merchant B reading merchant A payment by id', async () => {
      const createRes = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          merchantId: merchantAId,
          amount: 15,
          currency: 'USD',
          paymentMethod: 'CREDIT_CARD',
          cardDetails: VALID_CARD,
          idempotencyKey: randomUUID(),
        });
      expect(createRes.status).toBe(201);
      const paymentId = createRes.body.data.id;

      const merchantB = await registerMerchantUser();
      // A freshly-registered user with no merchantId can't legitimately
      // create payments, but CAN attempt to read an arbitrary payment id -
      // that's exactly the cross-merchant read this test checks is denied.

      const res = await request(app)
        .get(`/api/payments/${paymentId}`)
        .set('Authorization', `Bearer ${merchantB.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MERCHANT_ACCESS_DENIED');
    });
  });

  describe('Log redaction', () => {
    it('never logs a raw card number, using the actual production redact config', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pino = require('pino');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { LOG_REDACT_CONFIG } = require('../utils/logger');

      const lines: string[] = [];
      const captureStream = { write: (msg: string) => lines.push(msg) };
      const testLogger = pino({ redact: LOG_REDACT_CONFIG }, captureStream);

      const rawCardNumber = '4111111111111112'; // deliberately fails Luhn

      // Simulate exactly what error.middleware.ts logs on a request error -
      // the full request body, including nested cardDetails.
      testLogger.error(
        {
          body: {
            merchantId: merchantAId,
            amount: 10,
            cardDetails: { ...VALID_CARD, cardNumber: rawCardNumber },
          },
        },
        'Request error'
      );

      const allOutput = lines.join('\n');
      expect(allOutput).not.toContain(rawCardNumber);
      expect(allOutput).toContain('[REDACTED]');
    });

    it('produces the same non-leaking result through the real app pipeline on a validation failure', async () => {
      const res = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          merchantId: merchantAId,
          amount: 10,
          currency: 'USD',
          paymentMethod: 'CREDIT_CARD',
          cardDetails: { ...VALID_CARD, cardNumber: '4111111111111112' }, // fails Luhn
          idempotencyKey: randomUUID(),
        });

      // The API response itself must never echo the raw card number either.
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('4111111111111112');
    });
  });
});
