import { PrismaClient } from '@tradeos/db';
import { config } from '../config';

/**
 * A single client for the process. Prisma pools connections internally, so a
 * second instance would double the pool against the same database.
 */
export const prisma = new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
