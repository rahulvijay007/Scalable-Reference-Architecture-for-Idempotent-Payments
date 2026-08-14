import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { UserRole } from '@payment-platform/shared';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';

jest.mock('./database.service', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('./database.service');
import { authService } from './auth.service';

const baseUser = {
  id: 'user-1',
  email: 'merchant@example.com',
  password: '',
  firstName: 'Test',
  lastName: 'User',
  role: UserRole.MERCHANT,
  isActive: true,
  merchantId: 'merchant-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  describe('register', () => {
    it('throws USER_EXISTS when the email is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(
        authService.register({
          email: baseUser.email,
          password: 'Password123',
          firstName: 'Test',
          lastName: 'User',
        })
      ).rejects.toMatchObject({ statusCode: 400, code: 'USER_EXISTS' });
    });

    it('hashes the password and issues tokens for a new user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...baseUser, password: 'hashed' });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.register({
        email: baseUser.email,
        password: 'Password123',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: baseUser.email, role: UserRole.MERCHANT }),
        })
      );
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.email).toBe(baseUser.email);
      // Plaintext password must never leak back to the caller
      expect((result.user as unknown as { password?: string }).password).toBeUndefined();
    });
  });

  describe('login', () => {
    it('throws INVALID_CREDENTIALS when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'whatever' })
      ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    });

    it('throws USER_INACTIVE for a deactivated account', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, isActive: false });

      await expect(
        authService.login({ email: baseUser.email, password: 'whatever' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'USER_INACTIVE' });
    });

    it('throws INVALID_CREDENTIALS when the password does not match', async () => {
      const hashed = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hashed });

      await expect(
        authService.login({ email: baseUser.email, password: 'wrong-password' })
      ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    });

    it('returns tokens on successful login', async () => {
      const hashed = await bcrypt.hash('correct-password', 10);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, password: hashed });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.login({ email: baseUser.email, password: 'correct-password' });

      expect(result.accessToken).toBeTruthy();
      expect(result.user.role).toBe(UserRole.MERCHANT);
    });
  });

  describe('verifyAccessToken', () => {
    it('throws TOKEN_EXPIRED for an expired token', () => {
      const expired = jwt.sign({ userId: 'x' }, config.jwt.secret, { expiresIn: -1 });

      expect(() => authService.verifyAccessToken(expired)).toThrow(AppError);
      try {
        authService.verifyAccessToken(expired);
      } catch (error) {
        expect((error as AppError).code).toBe('TOKEN_EXPIRED');
      }
    });

    it('throws INVALID_TOKEN for a malformed token', () => {
      expect(() => authService.verifyAccessToken('not-a-jwt')).toThrow(AppError);
      try {
        authService.verifyAccessToken('not-a-jwt');
      } catch (error) {
        expect((error as AppError).code).toBe('INVALID_TOKEN');
      }
    });
  });
});
