import { NaiveStrategy } from './naive.strategy';
import { OptimisticStrategy } from './optimistic.strategy';
import { RedisLockStrategy } from './redis-lock.strategy';
import { IdempotencyStrategy, IdempotencyStrategyName } from './idempotency-strategy';

export function createIdempotencyStrategy(name: IdempotencyStrategyName): IdempotencyStrategy {
  switch (name) {
    case 'naive':
      return new NaiveStrategy();
    case 'redis-lock':
      return new RedisLockStrategy();
    case 'optimistic':
      return new OptimisticStrategy();
    default:
      // Exhaustiveness guard: if a new strategy name is added to the type
      // without a case here, this is a compile error, not a silent fallback.
      return ((n: never) => {
        throw new Error(`Unknown idempotency strategy: ${n}`);
      })(name);
  }
}

export * from './idempotency-strategy';
export { NaiveStrategy } from './naive.strategy';
export { OptimisticStrategy } from './optimistic.strategy';
export { RedisLockStrategy } from './redis-lock.strategy';
