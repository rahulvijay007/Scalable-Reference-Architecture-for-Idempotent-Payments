import Redis from 'ioredis';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Dedicated ioredis client for distributed locking. Deliberately NOT the
 * same client as `redis.service.ts`'s health-check-only singleton - that
 * client is tuned to fail fast (`maxRetriesPerRequest: 1`, no retry
 * strategy) for a fire-and-forget PING, which is the wrong behavior for a
 * lock that real request handling depends on.
 */
// lazyConnect: importing this module (which happens whenever payment.service.ts
// loads, regardless of the configured strategy) must not open a socket by
// itself - only the first actual command (from RedisLockStrategy.run())
// should trigger a connection attempt. Without this, every test run and
// every non-redis-lock deployment eagerly dials Redis and leaks the handle.
const lockClient = new Redis(config.redis.url, {
  password: config.redis.password,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

lockClient.on('error', (error) => {
  logger.error({ error }, 'Redis lock client connection error');
});

// Atomically release the lock only if it's still held by the caller (i.e.
// the stored value matches), so a lock acquired-then-expired-then-reacquired
// by a different holder is never released out from under that new holder.
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function acquireLock(key: string, value: string, ttlMs: number): Promise<boolean> {
  const result = await lockClient.set(key, value, 'PX', ttlMs, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string, value: string): Promise<void> {
  await lockClient.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, value);
}
