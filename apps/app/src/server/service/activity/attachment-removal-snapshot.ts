import type { AttachmentRemoveSnapshot } from '~/interfaces/activity';

/**
 * Input shape accepted by buildAttachmentRemoveSnapshot.
 *
 * NOTE: `pageId` is the Prisma alias for the Mongoose attachment's `page` field.
 * Callers holding a Mongoose attachment doc must map `page` -> `pageId` first.
 * Because `pageId` is optional, a forgotten mapping is not caught by the type
 * checker — `pageId` (and the `pagePath` resolved from it) would silently end
 * up `undefined` in the snapshot. The co-located spec pins this contract.
 */
export type AttachmentLike = {
  _id: string;
  originalName?: string;
  fileSize?: number;
  pageId?: string;
};

/**
 * Builds an AttachmentRemoveSnapshot from an attachment about to be removed,
 * the path of the page it belongs to, and the operator's username.
 *
 * Pure function shared by the direct-removal route and the cascade recorder
 * (requirements 2.1, 2.2, 3.3). Unresolvable inputs stay `undefined` in the
 * returned snapshot (requirement 2.3); no key stripping is needed because
 * both save ports (createByParameters / updateByParameters) read each field
 * explicitly and Prisma omits `undefined` values on persistence. Inputs are
 * never mutated — a new object is returned.
 */
export const buildAttachmentRemoveSnapshot = (
  attachment: AttachmentLike,
  pagePath: string | undefined,
  username: string | undefined,
): AttachmentRemoveSnapshot => ({
  username,
  originalName: attachment.originalName,
  pagePath,
  pageId: attachment.pageId,
  fileSize: attachment.fileSize,
});
