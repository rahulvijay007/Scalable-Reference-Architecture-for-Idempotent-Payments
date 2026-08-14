import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from './database.service';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import {
  JWTPayload,
  UserInfo,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  UserRole,
  ROLE_PERMISSIONS,
} from '@payment-platform/shared';
import { logger } from '../utils/logger';

export class AuthService {
  /**
   * Generate access token
   */
  private generateAccessToken(payload: JWTPayload): string {
    const options: jwt.SignOptions = { expiresIn: config.jwt.accessTokenExpiry as jwt.SignOptions['expiresIn'] };
    return jwt.sign(payload, config.jwt.secret, options);
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(): string {
    const options: jwt.SignOptions = { expiresIn: config.jwt.refreshTokenExpiry as jwt.SignOptions['expiresIn'] };
    return jwt.sign({ jti: uuidv4() }, config.jwt.refreshSecret, options);
  }

  /**
   * Verify access token
   */
  public verifyAccessToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
      }
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    }
  }

  /**
   * Verify refresh token
   */
  public verifyRefreshToken(token: string): { jti: string } {
    try {
      const decoded = jwt.verify(token, config.jwt.refreshSecret) as { jti: string };
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired');
      }
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid refresh token');
    }
  }

  /**
   * Register a new user
   */
  public async register(data: RegisterRequest): Promise<AuthResponse> {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new AppError(400, 'USER_EXISTS', 'User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || UserRole.MERCHANT,
        merchantId: data.merchantId,
      },
    });

    logger.info({ userId: user.id, email: user.email }, 'User registered');

    // Generate tokens
    const permissions = ROLE_PERMISSIONS[user.role];
    const jwtPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    const accessToken = this.generateAccessToken(jwtPayload);
    const refreshToken = this.generateRefreshToken();

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    return {
      accessToken,
      refreshToken,
      user: userInfo,
    };
  }

  /**
   * Login user
   */
  public async login(data: LoginRequest): Promise<AuthResponse> {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    logger.info({ userId: user.id, email: user.email }, 'User logged in');

    // Generate tokens
    const permissions = ROLE_PERMISSIONS[user.role];
    const jwtPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    const accessToken = this.generateAccessToken(jwtPayload);
    const refreshToken = this.generateRefreshToken();

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    return {
      accessToken,
      refreshToken,
      user: userInfo,
    };
  }

  /**
   * Refresh access token
   */
  public async refreshAccessToken(refreshToken: string): Promise<AuthResponse> {
    // Verify refresh token (validates signature/expiry; payload itself isn't needed here)
    this.verifyRefreshToken(refreshToken);

    // Check if refresh token exists and is not revoked
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.isRevoked) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or revoked refresh token');
    }

    if (new Date() > storedToken.expiresAt) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired');
    }

    const user = storedToken.user;

    if (!user.isActive) {
      throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
    }

    // Generate new tokens
    const permissions = ROLE_PERMISSIONS[user.role];
    const jwtPayload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    const accessToken = this.generateAccessToken(jwtPayload);
    const newRefreshToken = this.generateRefreshToken();

    // Revoke old refresh token and create new one
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    const userInfo: UserInfo = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: userInfo,
    };
  }

  /**
   * Logout user (revoke refresh token)
   */
  public async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { isRevoked: true },
    });

    logger.info('User logged out');
  }

  /**
   * Get user by ID
   */
  public async getUserById(userId: string): Promise<UserInfo> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const permissions = ROLE_PERMISSIONS[user.role];

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as UserRole,
      merchantId: user.merchantId || undefined,
      permissions,
    };
  }
}

export const authService = new AuthService();
