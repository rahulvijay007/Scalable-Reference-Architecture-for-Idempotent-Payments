import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from '../app';

/**
 * Full HTTP integration test for the payment lifecycle, run against a real
 * Postgres instance (see docker-compose.yml's postgres service). Requires
 * the database to be migrated and seeded first:
 *   docker compose up -d postgres
 *   pnpm prisma:migrate && pnpm prisma:seed
 */
const app = createApp();

const MERCHANT_CREDENTIALS = { email: 'merchant@payment-platform.com', password: 'Merchant@123456' };

const VALID_CARD = {
  cardNumber: '4111111111111111',
  expiryMonth: 12,
  expiryYear: new Date().getFullYear() + 2,
  cvv: '123',
  cardholderName: 'Integration Test',
};

async function loginAs(credentials: { email: string; password: string }) {
  const res = await request(app).post('/api/auth/login').send(credentials);
  if (res.status !== 200) {
    throw new Error(`Login failed for ${credentials.email}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { accessToken: string; user: { merchantId?: string } };
}

describe('Payment lifecycle (integration)', () => {
  let accessToken: string;
  let merchantId: string;

  beforeAll(async () => {
    const session = await loginAs(MERCHANT_CREDENTIALS);
    accessToken = session.accessToken;
    merchantId = session.user.merchantId as string;
  });

  it('authorizes, captures, and refunds a payment end-to-end', async () => {
    const idempotencyKey = randomUUID();

    const createRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        merchantId,
        amount: 200,
        currency: 'USD',
        paymentMethod: 'CREDIT_CARD',
        cardDetails: VALID_CARD,
        idempotencyKey,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.status).toBe('AUTHORIZED');
    const paymentId = createRes.body.data.id;

    const captureRes = await request(app)
      .post(`/api/payments/${paymentId}/capture`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(captureRes.status).toBe(200);
    expect(captureRes.body.data.status).toBe('CAPTURED');

    const refundRes = await request(app)
      .post(`/api/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amount: 200 });

    expect(refundRes.status).toBe(200);
    expect(refundRes.body.data.status).toBe('REFUNDED');

    const getRes = await request(app)
      .get(`/api/payments/${paymentId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.transactions).toHaveLength(3); // authorization, capture, refund
  });

  it('replays an identical idempotency key without creating a duplicate payment', async () => {
    const idempotencyKey = randomUUID();
    const payload = {
      merchantId,
      amount: 50,
      currency: 'USD',
      paymentMethod: 'CREDIT_CARD',
      cardDetails: VALID_CARD,
      idempotencyKey,
    };

    const first = await request(app).post('/api/payments').set('Authorization', `Bearer ${accessToken}`).send(payload);
    const second = await request(app).post('/api/payments').set('Authorization', `Bearer ${accessToken}`).send(payload);

    expect(first.body.data.id).toBe(second.body.data.id);
  });

  it('rejects a replayed idempotency key when the payload differs', async () => {
    const idempotencyKey = randomUUID();
    const base = {
      merchantId,
      currency: 'USD',
      paymentMethod: 'CREDIT_CARD',
      cardDetails: VALID_CARD,
      idempotencyKey,
    };

    await request(app).post('/api/payments').set('Authorization', `Bearer ${accessToken}`).send({ ...base, amount: 10 });

    const conflict = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...base, amount: 9999 });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('returns 403 when a user without CREATE_PAYMENT permission attempts to create a payment', async () => {
    // SUPPORT role has no CREATE_PAYMENT permission per ROLE_PERMISSIONS
    const registerRes = await request(app).post('/api/auth/register').send({
      email: `support-${randomUUID()}@payment-platform.com`,
      password: 'Support@123456',
      firstName: 'Support',
      lastName: 'Tester',
      role: 'SUPPORT',
    });
    expect(registerRes.status).toBe(201);
    const supportToken = registerRes.body.data.accessToken;

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({
        merchantId,
        amount: 10,
        currency: 'USD',
        paymentMethod: 'CREDIT_CARD',
        idempotencyKey: randomUUID(),
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('returns 401 when no credentials are supplied', async () => {
    const res = await request(app).get('/api/payments');
    expect(res.status).toBe(401);
  });
});
