import { Prisma } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:change-proposal:models');

// P2034 is the query engine giving up after repeated write conflicts; the caller did not write.
export const runConditionalWrite = async (
  write: () => Promise<{ count: number }>,
): Promise<boolean> => {
  try {
    const { count } = await write();
    return count > 0;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2034'
    ) {
      logger.warn(
        `Conditional write gave up after write conflicts: ${err.message}`,
      );
      return false;
    }
    throw err;
  }
};
