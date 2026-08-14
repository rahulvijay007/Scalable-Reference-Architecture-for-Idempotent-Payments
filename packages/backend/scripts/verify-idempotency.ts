/**
 * Ground-truth correctness check for research/benchmarks/k6/idempotency-race.js:
 * counts how many Payment (and related Transaction) rows actually exist for
 * a given idempotencyKey after a concurrent-race k6 run. The safety property
 * (research/formal-model/idempotency-protocol.md) requires this to be
 * exactly 1, regardless of concurrency or strategy.
 *
 * Usage: tsx scripts/verify-idempotency.ts <idempotencyKey> <resultFile>
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import 'dotenv/config';

async function main() {
  const [idempotencyKey, resultFile] = process.argv.slice(2);

  if (!idempotencyKey) {
    console.error('Usage: tsx scripts/verify-idempotency.ts <idempotencyKey> [resultFile]');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const payments = await prisma.payment.findMany({
      where: { idempotencyKey },
      include: { transactions: true },
    });

    const result = {
      idempotencyKey,
      paymentRowCount: payments.length,
      safetyHolds: payments.length <= 1,
      payments: payments.map((p) => ({
        id: p.id,
        status: p.status,
        amount: p.amount.toNumber(),
        transactionCount: p.transactions.length,
      })),
      checkedAt: new Date().toISOString(),
    };

    console.log(JSON.stringify(result, null, 2));

    if (resultFile) {
      let existing: Record<string, unknown> = {};
      if (existsSync(resultFile)) {
        try {
          existing = JSON.parse(readFileSync(resultFile, 'utf-8'));
        } catch {
          existing = {};
        }
      }
      writeFileSync(resultFile, JSON.stringify({ ...existing, verification: result }, null, 2));
    }

    if (!result.safetyHolds) {
      console.error(`SAFETY VIOLATION: expected at most 1 Payment row for key ${idempotencyKey}, found ${payments.length}`);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
