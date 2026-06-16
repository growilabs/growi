import { getIdForRef, type IAttachment } from '@growi/core';

import loggerFactory from '~/utils/logger';

import type { ShareLinkDocument } from '../../models/share-link';
import { getModelSafely } from '../../util/mongoose-utils';

const logger = loggerFactory(
  'growi:middleware:certify-shared-page-attachment:validate-attachment',
);

export const validateAttachment = async (
  fileId: string,
  shareLink: ShareLinkDocument,
): Promise<boolean> => {
  const Attachment = getModelSafely<IAttachment>('Attachment');
  if (Attachment == null) {
    logger.warn(
      'Could not get Attachment model. next() will be called without processing anything.',
    );
    return false;
  }

  const relatedPageId = getIdForRef(shareLink.relatedPage);
  const result = await Attachment.exists({
    _id: fileId,
    page: relatedPageId,
  });

  return result != null;
};
