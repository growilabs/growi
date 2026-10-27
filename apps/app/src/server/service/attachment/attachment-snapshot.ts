import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { AttachmentSnapshot } from '~/interfaces/activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:attachment:attachment-snapshot');

/** A page reference id: a Mongoose ObjectId or its string representation. */
type ObjectIdLike = mongoose.Types.ObjectId | string;

/**
 * Input shape accepted by buildAttachmentSnapshot.
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
 * Operator of an attachment-affecting operation. Shared with
 * deleteCompletelyOperation's actor Parameter Object (task 5.1 imports this
 * type). `user` is required; `ip`/`endpoint` are optional because the
 * cascade / empty-trash paths reach deleteCompletelyOperation with only a
 * user (design: ip/endpoint degradation).
 */
export type ActivityActor = {
  user: IUserHasId;
  ip?: string;
  endpoint?: string;
};

/**
 * Builds an AttachmentSnapshot from an attachment, the path of the page it
 * belongs to, and the operator's username.
 *
 * Action-agnostic pure function shared by every attachment action capture
 * (REMOVE today; ADD/DOWNLOAD reuse the same shape — requirements 6.1, 6.2,
 * 7.1). Unresolvable inputs stay `undefined` in the returned snapshot
 * (graceful degradation, requirements 6.4, 7.3); no key stripping is needed
 * because both save ports (createByParameters / updateByParameters) read
 * each field explicitly and Prisma omits `undefined` values on persistence.
 * Inputs are never mutated — a new object is returned. This function never
 * fetches the Page; resolving `pagePath` is the caller's (or
 * resolveAttachmentPagePath's) concern.
 */
export const buildAttachmentSnapshot = (
  attachment: AttachmentLike,
  pagePath: string | undefined,
  username: string | undefined,
): AttachmentSnapshot => ({
  username,
  originalName: attachment.originalName,
  pagePath,
  pageId: attachment.pageId,
  fileSize: attachment.fileSize,
});

/**
 * Operator of an attachment download. Same shape as ActivityActor except
 * `user` is optional: the download route can be reached unauthenticated when
 * guest (anonymous) access is allowed, and the snapshot then simply omits
 * `username` (requirement 7.2). Declared as a separate type so that
 * ActivityActor keeps `user` required — a deliberate contract for the
 * removal-cascade path, which always has an operating user.
 */
export type DownloadActor = Omit<ActivityActor, 'user'> & {
  user?: IUserHasId;
};

/**
 * Resolves the path of the page an attachment belongs to, for an activity
 * snapshot.
 *
 * Single home of the pagePath resolution shared by the attachment capture
 * points. Returns undefined with a warning log when the page cannot be
 * resolved, so that the snapshot is recorded without pagePath (graceful
 * degradation, requirements 6.4, 7.3). A missing page reference (e.g.
 * profile image attachments) is a normal state and resolves to undefined
 * silently. `context.attachmentId` only enriches the warning log.
 */
export const resolveAttachmentPagePath = async (
  pageRef: ObjectIdLike | undefined,
  context: { attachmentId?: ObjectIdLike } = {},
): Promise<string | undefined> => {
  if (pageRef == null) {
    return undefined;
  }

  // Obtained lazily so this module can be imported before Page is registered.
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  try {
    const page = await Page.findById(pageRef);
    if (page != null) {
      return page.path;
    }
    // Context goes first (pino convention) so it lands as structured fields;
    // a string-first call would silently discard the context object.
    logger.warn(
      { attachmentId: context.attachmentId, pageId: pageRef },
      'The page of the attachment was not found. The activity snapshot will be recorded without pagePath.',
    );
  } catch (err) {
    logger.warn(
      { err, attachmentId: context.attachmentId, pageId: pageRef },
      'Failed to find the page of the attachment. The activity snapshot will be recorded without pagePath.',
    );
  }
  return undefined;
};

/**
 * Builds the snapshot for an ACTION_ATTACHMENT_DOWNLOAD activity: resolves
 * the attachment's page reference into pagePath via
 * resolveAttachmentPagePath (which already warns on a miss — no extra
 * warning here), then delegates to buildAttachmentSnapshot. A thin async
 * wrapper so the download route stays a one-line call (requirements
 * 7.1-7.3).
 *
 * The Mongoose attachment holds its page reference as `page` (ObjectId or
 * string); it is stringified here into the builder's `pageId` — a missed
 * conversion would silently drop pageId/pagePath (the REMOVE-era pitfall;
 * the co-located spec pins it). An already-mapped `pageId` is preserved
 * when no `page` reference is present. Fields are read explicitly (never
 * spread) so Mongoose documents, whose schema fields live on the prototype
 * as getters, resolve correctly. Inputs are never mutated.
 */
export const buildAttachmentDownloadSnapshot = async (
  attachment: AttachmentLike & { page?: ObjectIdLike },
  actor: DownloadActor,
): Promise<AttachmentSnapshot> => {
  const pagePath = await resolveAttachmentPagePath(attachment.page, {
    attachmentId: attachment._id,
  });

  return buildAttachmentSnapshot(
    {
      _id: attachment._id,
      originalName: attachment.originalName,
      fileSize: attachment.fileSize,
      pageId: attachment.page?.toString() ?? attachment.pageId,
    },
    pagePath,
    actor.user?.username,
  );
};
