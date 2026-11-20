import type { PrismaClient } from '~/generated/prisma/client.js';

/**
 * Migration function type
 */
export type Migration = (args: { context: PrismaClient }) => Promise<void>;
