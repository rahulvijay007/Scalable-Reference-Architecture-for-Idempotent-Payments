import { z } from 'zod';

// User Roles
export enum UserRole {
  ADMIN = 'ADMIN',
  MERCHANT = 'MERCHANT',
  DEVELOPER = 'DEVELOPER',
  SUPPORT = 'SUPPORT',
}

// Permissions
export enum Permission {
  // Payment permissions
  CREATE_PAYMENT = 'CREATE_PAYMENT',
  READ_PAYMENT = 'READ_PAYMENT',
  CAPTURE_PAYMENT = 'CAPTURE_PAYMENT',
  REFUND_PAYMENT = 'REFUND_PAYMENT',
  CANCEL_PAYMENT = 'CANCEL_PAYMENT',

  // Merchant permissions
  CREATE_MERCHANT = 'CREATE_MERCHANT',
  READ_MERCHANT = 'READ_MERCHANT',
  UPDATE_MERCHANT = 'UPDATE_MERCHANT',
  DELETE_MERCHANT = 'DELETE_MERCHANT',

  // User permissions
  CREATE_USER = 'CREATE_USER',
  READ_USER = 'READ_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',

  // API Key permissions
  CREATE_API_KEY = 'CREATE_API_KEY',
  READ_API_KEY = 'READ_API_KEY',
  REVOKE_API_KEY = 'REVOKE_API_KEY',

  // Analytics permissions
  READ_ANALYTICS = 'READ_ANALYTICS',

  // System permissions
  MANAGE_WEBHOOKS = 'MANAGE_WEBHOOKS',
  VIEW_AUDIT_LOGS = 'VIEW_AUDIT_LOGS',
}

// Role-Permission mapping
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: Object.values(Permission),
  [UserRole.MERCHANT]: [
    Permission.CREATE_PAYMENT,
    Permission.READ_PAYMENT,
    Permission.CAPTURE_PAYMENT,
    Permission.REFUND_PAYMENT,
    Permission.CANCEL_PAYMENT,
    Permission.READ_MERCHANT,
    Permission.UPDATE_MERCHANT,
    Permission.CREATE_API_KEY,
    Permission.READ_API_KEY,
    Permission.REVOKE_API_KEY,
    Permission.READ_ANALYTICS,
    Permission.MANAGE_WEBHOOKS,
  ],
  [UserRole.DEVELOPER]: [
    Permission.CREATE_PAYMENT,
    Permission.READ_PAYMENT,
    Permission.CAPTURE_PAYMENT,
    Permission.REFUND_PAYMENT,
    Permission.READ_MERCHANT,
    Permission.CREATE_API_KEY,
    Permission.READ_API_KEY,
    Permission.REVOKE_API_KEY,
  ],
  [UserRole.SUPPORT]: [
    Permission.READ_PAYMENT,
    Permission.READ_MERCHANT,
    Permission.READ_USER,
    Permission.READ_ANALYTICS,
    Permission.VIEW_AUDIT_LOGS,
  ],
};

// Zod Schemas
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.nativeEnum(UserRole).optional(),
  merchantId: z.string().uuid().optional(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// TypeScript types
export type LoginRequest = z.infer<typeof LoginSchema>;
export type RegisterRequest = z.infer<typeof RegisterSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenSchema>;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  merchantId?: string;
  permissions: Permission[];
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  merchantId?: string;
  permissions: Permission[];
}
