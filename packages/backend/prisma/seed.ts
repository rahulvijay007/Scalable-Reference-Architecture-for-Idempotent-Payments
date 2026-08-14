import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateApiKey, hashData } from '@payment-platform/shared';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123456', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@payment-platform.com' },
    update: {},
    create: {
      email: 'admin@payment-platform.com',
      password: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.ADMIN,
    },
  });
  console.log('✅ Created admin user:', admin.email);

  // Create demo merchant
  const merchant = await prisma.merchant.upsert({
    where: { email: 'demo@merchant.com' },
    update: {},
    create: {
      name: 'Demo Merchant',
      email: 'demo@merchant.com',
      description: 'Demo merchant for testing',
      website: 'https://demo-merchant.com',
      businessName: 'Demo Business LLC',
    },
  });
  console.log('✅ Created merchant:', merchant.name);

  // Create merchant user
  const merchantPassword = await bcrypt.hash('Merchant@123456', 10);
  const merchantUser = await prisma.user.upsert({
    where: { email: 'merchant@payment-platform.com' },
    update: {},
    create: {
      email: 'merchant@payment-platform.com',
      password: merchantPassword,
      firstName: 'Merchant',
      lastName: 'User',
      role: UserRole.MERCHANT,
      merchantId: merchant.id,
    },
  });
  console.log('✅ Created merchant user:', merchantUser.email);

  // Create API key for merchant
  const apiKey = generateApiKey('pk_test');
  const apiKeyHash = hashData(apiKey);

  await prisma.apiKey.create({
    data: {
      key: apiKey,
      keyHash: apiKeyHash,
      name: 'Demo API Key',
      merchantId: merchant.id,
      permissions: JSON.stringify(['CREATE_PAYMENT', 'READ_PAYMENT', 'CAPTURE_PAYMENT', 'REFUND_PAYMENT']),
    },
  });
  console.log('✅ Created API key:', apiKey);
  console.log('⚠️  Save this API key - it will not be shown again!');

  // Create webhook for merchant
  const webhook = await prisma.webhook.create({
    data: {
      merchantId: merchant.id,
      url: 'https://demo-merchant.com/webhooks',
      secret: generateApiKey('whsec'),
      events: JSON.stringify([
        'payment.authorized',
        'payment.captured',
        'payment.failed',
        'payment.refunded',
      ]),
    },
  });
  console.log('✅ Created webhook:', webhook.url);

  console.log('\n🎉 Database seeded successfully!');
  console.log('\n📝 Login credentials:');
  console.log('Admin:');
  console.log('  Email: admin@payment-platform.com');
  console.log('  Password: Admin@123456');
  console.log('\nMerchant:');
  console.log('  Email: merchant@payment-platform.com');
  console.log('  Password: Merchant@123456');
  console.log(`\nAPI Key: ${apiKey}`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
