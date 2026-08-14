import { generateApiKey, hashData, Permission } from '@payment-platform/shared';
import { prisma } from './database.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

/**
 * Mask a raw API key for storage/display, e.g. "pk_test_abcd...1234" -> "pk_test_****1234".
 * The raw key is only ever returned once, at creation time.
 */
function maskApiKey(rawKey: string): string {
  const last4 = rawKey.slice(-4);
  const prefixMatch = rawKey.match(/^[a-z0-9]+_/i);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  return `${prefix}****${last4}`;
}

export class ApiKeyService {
  public async create(merchantId: string, name: string, permissions: Permission[]) {
    const rawKey = generateApiKey('pk');
    const keyHash = hashData(rawKey);

    const apiKey = await prisma.apiKey.create({
      data: {
        key: maskApiKey(rawKey),
        keyHash,
        name,
        merchantId,
        permissions: permissions as unknown as object,
      },
    });

    logger.info({ apiKeyId: apiKey.id, merchantId }, 'API key created');

    // Raw key returned only here - never persisted or logged in plaintext
    return { ...apiKey, key: rawKey };
  }

  public async list(merchantId: string) {
    return prisma.apiKey.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        key: true,
        name: true,
        merchantId: true,
        permissions: true,
        lastUsedAt: true,
        isActive: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  public async revoke(id: string, merchantId: string) {
    const apiKey = await prisma.apiKey.findUnique({ where: { id } });

    if (!apiKey || apiKey.merchantId !== merchantId) {
      throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found');
    }

    await prisma.apiKey.update({ where: { id }, data: { isActive: false } });

    logger.info({ apiKeyId: id, merchantId }, 'API key revoked');
  }
}

export const apiKeyService = new ApiKeyService();
