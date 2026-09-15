/**
 * Operator CLI for the things that have no UI, because they must not have one.
 *
 *   npx tsx --env-file=../../.env src/scripts/admin.ts promote you@example.com
 *   npx tsx --env-file=../../.env src/scripts/admin.ts create-admin you@example.com "Your Name"
 *   npx tsx --env-file=../../.env src/scripts/admin.ts verify you@example.com
 *   npx tsx --env-file=../../.env src/scripts/admin.ts list
 *
 * There is deliberately no in-app way to grant yourself admin: that is a
 * shell-access operation, not a button.
 */

import { prisma } from '../lib/prisma';
import { generateToken, hashPassword } from '../lib/crypto';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'promote':
      await promote(required(args[0], 'email'));
      break;
    case 'create-admin':
      await createAdmin(required(args[0], 'email'), args[1] ?? 'Administrator');
      break;
    case 'verify':
      await verify(required(args[0], 'email'));
      break;
    case 'list':
      await list();
      break;
    default:
      console.log(
        [
          'Usage:',
          '  promote <email>              make an existing user an administrator',
          '  create-admin <email> [name]  create an admin with a generated password',
          '  verify <email>               mark an email verified without the link',
          '  list                         list users and their account counts',
        ].join('\n'),
      );
      process.exitCode = 1;
  }

  await prisma.$disconnect();
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing required argument: ${name}`);
    process.exit(1);
  }
  return value.toLowerCase();
}

async function promote(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  console.log(`${email} is now an administrator.`);
}

async function createAdmin(email: string, name: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`${email} already exists — use "promote" instead.`);
    process.exitCode = 1;
    return;
  }

  // Generated rather than prompted: a password typed at a shell ends up in the
  // shell history, and this one is meant to be changed on first sign-in anyway.
  const password = generateToken(12);

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
      emailVerified: true,
      settings: { create: {} },
    },
  });

  console.log(`Created administrator ${email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in and change it immediately.');
}

async function verify(email: string): Promise<void> {
  const result = await prisma.user.updateMany({
    where: { email },
    data: { emailVerified: true },
  });

  if (result.count === 0) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${email} is now verified.`);
}

async function list(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerified: true,
      _count: { select: { accounts: true } },
    },
  });

  if (users.length === 0) {
    console.log('No users yet.');
    return;
  }

  console.table(
    users.map((u) => ({
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      verified: u.emailVerified,
      accounts: u._count.accounts,
    })),
  );
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
