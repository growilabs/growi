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
 * Minimal structural surface of a prisma attachment row that the builder
 * reads. `_id` is optional only because a hand-built fixture may omit it —
 * a row returned by `prisma.attachments.findMany` always has one at runtime
 * (the extension's computed field).
 */
export type AttachmentSource = {
  _id?: ObjectIdLike;
  originalName?: string | null;
  fileSize?: number;
  pageId?: string | null;
};

/**
 * Maps prisma attachment rows to the AttachmentLike shape consumed by the
 * cascade recorder. An attachment without `_id` (a typing artifact) is
 * excluded rather than given a bogus activity target; an attachment without
 * a page reference is kept, with `pageId` left undefined (design:
 * unresolvable inputs degrade to undefined).
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
        originalName: attachment.originalName ?? undefined,
        fileSize: attachment.fileSize,
        pageId: attachment.pageId ?? undefined,
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
