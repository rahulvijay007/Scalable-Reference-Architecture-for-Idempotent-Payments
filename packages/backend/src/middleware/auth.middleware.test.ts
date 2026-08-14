import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@payment-platform/shared';

jest.mock('../services/auth.service', () => ({
  authService: { verifyAccessToken: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authService } = require('../services/auth.service');
import { authenticate, optionalAuthenticate } from './auth.middleware';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const res = {} as Response;

describe('authenticate', () => {
  it('calls next() with a 401 AppError when the Authorization header is missing', async () => {
    const req = mockReq();
    const next = jest.fn() as NextFunction;

    await authenticate(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('MISSING_TOKEN');
  });

  it('calls next() with a 401 AppError when the header is not a Bearer token', async () => {
    const req = mockReq({ authorization: 'Basic abc123' });
    const next = jest.fn() as NextFunction;

    await authenticate(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.statusCode).toBe(401);
  });

  it('attaches req.user and calls next() with no error for a valid token', async () => {
    const payload = { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, permissions: [] };
    authService.verifyAccessToken.mockReturnValue(payload);

    const req = mockReq({ authorization: 'Bearer valid-token' });
    const next = jest.fn() as NextFunction;

    await authenticate(req, res, next);

    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('optionalAuthenticate', () => {
  it('proceeds without a user when no Authorization header is present', async () => {
    const req = mockReq();
    const next = jest.fn() as NextFunction;

    await optionalAuthenticate(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('swallows verification failures and still calls next()', async () => {
    authService.verifyAccessToken.mockImplementation(() => {
      throw new Error('invalid');
    });

    const req = mockReq({ authorization: 'Bearer bad-token' });
    const next = jest.fn() as NextFunction;

    await optionalAuthenticate(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
