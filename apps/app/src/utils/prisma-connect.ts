import loggerFactory from '~/utils/logger';

import type { PrismaClient } from './prisma';
import { prisma } from './prisma';

const logger = loggerFactory('growi:utils:prisma-connect');

/**
 * Warm up the Prisma client at boot instead of deferring it to the first query.
 *
 * The Prisma JS client object is constructed at module scope (`prisma.ts`), but
 * its native query engine (+12.5 MiB RSS) only loads lazily on first use. Left
 * lazy, that cost is invisible to startup memory measurements used for capacity
 * planning, and a broken Prisma connection would only surface on a user's first
 * request instead of aborting boot -- unlike a mongoose connection failure.
 * Calling this explicitly from crowi `init()` (right after `setupDatabase()`)
 * makes both failure modes and memory costs visible at boot time.
 *
 * `client` is injectable for unit testing without a real database connection;
 * it defaults to the real singleton for production use.
 */
export async function connectPrismaAtBoot(
  client: Pick<PrismaClient, '$connect'> = prisma,
): Promise<void> {
  try {
    await client.$connect();
    logger.debug('Prisma client connected at boot');
  } catch (err) {
    logger.error('Failed to connect Prisma client at boot', err);
    throw err;
  }
}
