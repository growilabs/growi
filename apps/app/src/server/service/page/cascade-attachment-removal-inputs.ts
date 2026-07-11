import type { IPage, Ref } from '@growi/core';
import { getIdStringForRef } from '@growi/core';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type { AttachmentLike } from '../attachment/attachment-removal-snapshot';

/**
 * Pure builders that prepare the inputs of recordCascadeAttachmentRemovals
 * from the data available inside deleteCompletelyOperation (requirements
 * 3.1-3.4). Both builders stringify ObjectIds so that the recorder's
 * `pageIdToPath.get(attachment.pageId)` lookup matches — if either side kept
 * raw ObjectIds, pagePath/pageId would silently drop out of the snapshot
 * (design: Snapshot Builder Implementation Notes). Pinned by the co-located
 * spec.
 */

/**
 * Minimal structural surface of a Mongoose attachment document that the
 * builder reads. The Mongoose schema holds the page reference as `page`,
 * while the recorder's AttachmentLike reads `pageId` (the Prisma alias);
 * the rename is centralized here so call sites cannot forget it.
 * `_id` is optional only because the Mongoose Document typing declares it
 * so — a found document always has one at runtime.
 */
export type AttachmentSource = {
  _id?: ObjectIdLike;
  originalName?: string;
  fileSize?: number;
  page?: Ref<IPage>;
};

/**
 * Maps Mongoose attachment documents to the AttachmentLike shape consumed by
 * the cascade recorder. An attachment without `_id` (a typing artifact that
 * cannot occur for found documents) is excluded rather than given a bogus
 * activity target; an attachment without a page reference is kept, with
 * `pageId` left undefined (design: unresolvable inputs degrade to undefined).
 */
export const toAttachmentLikes = (
  attachments: AttachmentSource[],
): AttachmentLike[] => {
  return attachments.flatMap((attachment) => {
    if (attachment._id == null) {
      return [];
    }
    return [
      {
        _id: attachment._id.toString(),
        originalName: attachment.originalName,
        fileSize: attachment.fileSize,
        pageId:
          attachment.page != null
            ? getIdStringForRef(attachment.page)
            : undefined,
      },
    ];
  });
};

/**
 * Builds the pageId -> path lookup consumed by the cascade recorder from the
 * parallel `pageIds` / `pagePaths` arguments of deleteCompletelyOperation.
 * Keys are ObjectId string forms so they match AttachmentLike.pageId. An id
 * without a corresponding path yields no entry — the recorder then records
 * that attachment with pagePath undefined instead of failing.
 */
export const buildPageIdToPathMap = (
  pageIds: ObjectIdLike[],
  pagePaths: (string | undefined)[],
): Map<string, string> => {
  const map = new Map<string, string>();
  pageIds.forEach((pageId, i) => {
    const pagePath = pagePaths[i];
    if (pagePath != null) {
      map.set(pageId.toString(), pagePath);
    }
  });
  return map;
};
