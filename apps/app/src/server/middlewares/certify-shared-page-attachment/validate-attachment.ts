import type { IAttachment } from '@growi/core';

import type { sharelinks } from '~/generated/prisma/client';
import { getModelSafely } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:middleware:certify-shared-page-attachment:validate-attachment',
);

export const validateAttachment = async (
  fileId: string,
  shareLink: sharelinks,
): Promise<boolean> => {
  const Attachment = getModelSafely<IAttachment>('Attachment');
  if (Attachment == null) {
    logger.warn(
      'Could not get Attachment model. next() will be called without processing anything.',
    );
    return false;
  }

  const result = await Attachment.exists({
    _id: fileId,
    page: shareLink.relatedPageId,
  });

  return result != null;
};
