import type { IUserHasId } from '@growi/core';

import {
  type AttachmentRemoveSnapshot,
  type IActivity,
  MODEL_ATTACHMENT,
  SupportedAction,
} from '~/interfaces/activity';
import type { IActivityParameters } from '~/server/models/activity';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:activity:attachment-removal-snapshot',
);

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

/**
 * Operator of a (cascade) deletion. Shared with deleteCompletelyOperation's
 * actor Parameter Object (task 5.1 imports this type). `user` is required;
 * `ip`/`endpoint` are optional because the cascade / empty-trash paths reach
 * deleteCompletelyOperation with only a user (design: ip/endpoint degradation).
 */
export type ActivityActor = {
  user: IUserHasId;
  ip?: string;
  endpoint?: string;
};

/**
 * Minimal structural surface of ActivityService that the recorder depends on
 * (executor principle: the dependency is injected, not imported). The real
 * ActivityService instance is assignable to this type — pinned by a
 * compile-time check in the co-located spec.
 */
export type ActivityCreator = {
  createActivity: (
    parameters: IActivityParameters,
  ) => Promise<IActivity | null>;
};

/**
 * Records one ACTION_ATTACHMENT_REMOVE activity per attachment removed by a
 * cascade deletion (page complete-delete / empty-trash; requirements 3.1, 3.2).
 * Must be called BEFORE the attachments are removed from storage (req 3.4).
 *
 * The work-set (attachments, pageId -> path map, actor) is received as
 * arguments — the recorder fetches no data itself. Recording-scope gating is
 * delegated to createActivity's internal shoudUpdateActivity check (it
 * resolves null when the action is not recorded); the recorder does not
 * duplicate that gate. Attachments whose page is absent from `pageIdToPath`
 * are still recorded, with `pagePath` left undefined (design: Validation).
 */
export const recordCascadeAttachmentRemovals = async (
  activityService: ActivityCreator,
  attachments: AttachmentLike[],
  pageIdToPath: Map<string, string>,
  actor: ActivityActor,
): Promise<void> => {
  for (const attachment of attachments) {
    const pagePath =
      attachment.pageId != null
        ? pageIdToPath.get(attachment.pageId)
        : undefined;
    const snapshot = buildAttachmentRemoveSnapshot(
      attachment,
      pagePath,
      actor.user.username,
    );

    try {
      // Each activity targets the attachment's own _id, so records never
      // collide on the unique index even within one cascade.
      // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose — a cascade may hold thousands of attachments, and unbounded parallel createActivity calls would flood the DB (design: Risks / Open Questions on cascade volume)
      await activityService.createActivity({
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
        target: attachment._id,
        targetModel: MODEL_ATTACHMENT,
        snapshot,
        user: actor.user,
        ip: actor.ip,
        endpoint: actor.endpoint,
      });
    } catch (err) {
      // One failed record must not stop the remaining records nor the
      // deletion itself (design: Error Handling > cascade individual failure).
      // Context goes first (pino convention) so it lands as structured fields.
      logger.error(
        { err, attachmentId: attachment._id, pageId: attachment.pageId },
        'Failed to create an activity for a cascade attachment removal',
      );
    }
  }
};
