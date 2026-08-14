import { Request, Response, NextFunction } from 'express';
import { Permission, UserRole } from '@payment-platform/shared';
import { requirePermission, requireRole, requireMerchantAccess } from './authorization.middleware';
import { AppError } from './error.middleware';

function mockReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, body: {}, ...overrides } as unknown as Request;
}

const res = {} as Response;

describe('requirePermission', () => {
  it('calls next() with no error when the user has one of the required permissions', () => {
    const req = mockReq({
      user: { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, permissions: [Permission.CREATE_PAYMENT] },
    });
    const next = jest.fn() as NextFunction;

    requirePermission(Permission.CREATE_PAYMENT)(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() with a 403 AppError when the user lacks the permission', () => {
    const req = mockReq({
      user: { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, permissions: [Permission.READ_PAYMENT] },
    });
    const next = jest.fn() as NextFunction;

    requirePermission(Permission.CREATE_PAYMENT)(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('calls next() with a 401 AppError when there is no authenticated user', () => {
    const req = mockReq();
    const next = jest.fn() as NextFunction;

    requirePermission(Permission.CREATE_PAYMENT)(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  it('allows a matching role', () => {
    const req = mockReq({ user: { userId: 'u1', email: 'a@b.com', role: UserRole.ADMIN, permissions: [] } });
    const next = jest.fn() as NextFunction;

    requireRole(UserRole.ADMIN)(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a non-matching role with 403', () => {
    const req = mockReq({ user: { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, permissions: [] } });
    const next = jest.fn() as NextFunction;

    requireRole(UserRole.ADMIN)(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.statusCode).toBe(403);
  });
});

describe('requireMerchantAccess', () => {
  it('lets an admin through regardless of merchantId', () => {
    const req = mockReq({
      user: { userId: 'u1', email: 'a@b.com', role: UserRole.ADMIN, permissions: [] },
      params: { merchantId: 'someone-elses-merchant' },
    });
    const next = jest.fn() as NextFunction;

    requireMerchantAccess()(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('allows a merchant user accessing their own merchantId', () => {
    const req = mockReq({
      user: { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, merchantId: 'm1', permissions: [] },
      body: { merchantId: 'm1' },
    });
    const next = jest.fn() as NextFunction;

    requireMerchantAccess()(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a merchant user accessing a different merchantId', () => {
    const req = mockReq({
      user: { userId: 'u1', email: 'a@b.com', role: UserRole.MERCHANT, merchantId: 'm1', permissions: [] },
      body: { merchantId: 'm2' },
    });
    const next = jest.fn() as NextFunction;

    requireMerchantAccess()(req, res, next);

    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('MERCHANT_ACCESS_DENIED');
  });
});
