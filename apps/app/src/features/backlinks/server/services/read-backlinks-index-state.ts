import { prisma } from '~/utils/prisma';

import type { IBacklinksIndexState } from '../../interfaces/backlink';
import { toBacklinksIndexState } from './backlinks-index-state';

/**
 * One read of the job document for the backlinks panel. Unlike the admin state it counts no
 * pages and does not recreate a missing document, since every page view pays for it.
 */
export const readBacklinksIndexState =
  async (): Promise<IBacklinksIndexState> => {
    const job = await prisma.pagelinkbackfilljobs.findFirst({
      select: { coverage: true, coveredSince: true },
    });
    return toBacklinksIndexState(job);
  };
