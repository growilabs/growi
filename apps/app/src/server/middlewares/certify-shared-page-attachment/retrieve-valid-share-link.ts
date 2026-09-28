import type { sharelinks } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ValidReferer } from './interfaces';

const logger = loggerFactory(
  'growi:middleware:certify-shared-page-attachment:retrieve-valid-share-link',
);

export const retrieveValidShareLinkByReferer = async (
  referer: ValidReferer,
): Promise<sharelinks | null> => {
  const { shareLinkId } = referer;
  const shareLink = await prisma.sharelinks.findUnique({
    where: { id: shareLinkId },
  });
  if (shareLink == null || shareLink.isExpired()) {
    logger.info(
      `ShareLink ('${shareLinkId}') is not found or has already expired.`,
    );
    return null;
  }

  return shareLink;
};
