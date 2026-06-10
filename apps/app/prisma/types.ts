import type { PrismaClient } from '~/generated/prisma/client';

/**
 * Migration function type
 */
export type Migration = (args: { context: PrismaClient }) => Promise<void>;
