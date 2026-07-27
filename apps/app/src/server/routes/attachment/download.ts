import { getIdStringForRef, type IUserHasId } from '@growi/core';
import type { Router } from 'express';
import express from 'express';

import { MODEL_ATTACHMENT, SupportedAction } from '~/interfaces/activity';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { IActivityParameters } from '~/server/models/activity';
import {
  buildAttachmentDownloadSnapshot,
  type DownloadActor,
} from '~/server/service/attachment/attachment-snapshot';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { certifySharedPageAttachmentMiddleware } from '../../middlewares/certify-shared-page-attachment';
import type { IAttachmentDocument } from '../../models/attachment';
import type { GetRequest, GetResponse } from './get';
import { getActionFactory, retrieveAttachmentFromIdParam } from './get';

const logger = loggerFactory('growi:routes:attachment:download');

/**
 * Download route request type: GetRequest with `req.user` narrowed to
 * IUserHasId — the codebase idiom for activity-recording routes (cf.
 * middlewares/add-activity.ts). `user` stays optional because guest
 * (anonymous) download is allowed (requirement 7.2); when absent, the
 * recorded snapshot simply omits `username`.
 */
type DownloadRequest = GetRequest & { user?: IUserHasId };

/**
 * Records an ACTION_ATTACHMENT_DOWNLOAD activity with an attachment
 * snapshot, best-effort (requirement 7.4).
 *
 * MUST be called fire-and-forget AFTER the file response has been
 * dispatched: every await inside (the snapshot construction, which includes
 * the pagePath resolution via Page.findById) then happens off the response
 * path and never adds latency to the download response (design: DOWNLOAD
 * Capture Integration, 実行順序).
 *
 * createActivity already swallows persistence failures internally (logs and
 * resolves null — including the unique-index collision of a
 * same-millisecond double download). The try/catch here adds the missing
 * protection: a snapshot-build or pagePath-resolution failure, or any other
 * unexpected rejection, is logged and swallowed so the recording can never
 * surface as an unhandled rejection nor affect the response.
 */
const recordDownloadActivity = async (
  crowi: Crowi,
  attachment: IAttachmentDocument,
  actor: DownloadActor,
): Promise<void> => {
  // String() keeps this line throw-free even in impossible edge states
  // (e.g. a missing _id), so the try/catch below covers every failure
  // surface of the recording. Document#_id is `any` in Mongoose 6 typings;
  // String() also pins the value to `string` so the parameters stay typed.
  const attachmentId = String(attachment._id);

  try {
    // Read schema fields explicitly: Mongoose documents expose them via
    // prototype getters, so an object spread would silently drop them.
    const snapshot = await buildAttachmentDownloadSnapshot(
      {
        _id: attachmentId,
        originalName: attachment.originalName,
        fileSize: attachment.fileSize,
        // page ref (ObjectId) -> id string; the builder maps it to pageId
        // and resolves pagePath from it
        page:
          attachment.page != null
            ? getIdStringForRef(attachment.page)
            : undefined,
      },
      actor,
    );

    const activityParameters: IActivityParameters = {
      ip: actor.ip,
      endpoint: actor.endpoint,
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
      user: actor.user?._id,
      target: attachmentId,
      targetModel: MODEL_ATTACHMENT,
      snapshot,
    };

    await crowi.activityService.createActivity(activityParameters);
  } catch (err) {
    // Best-effort (requirement 7.4): a recording failure must never affect
    // the already-dispatched download response.
    logger.warn(
      { err, attachmentId },
      'Failed to record the attachment download activity',
    );
  }
};

export const downloadRouterFactory = (crowi: Crowi): Router => {
  const loginRequired = loginRequiredFactory(crowi, true);

  const router = express.Router();

  // note: retrieveAttachmentFromIdParam requires `req.params.id`
  router.get<{ id: string }>(
    '/:id([0-9a-z]{24})',
    certifySharedPageAttachmentMiddleware,
    loginRequired,
    retrieveAttachmentFromIdParam,

    async (req: DownloadRequest, res: GetResponse) => {
      const { attachment } = res.locals;

      // Capture the request-scoped actor synchronously, before the response
      // is dispatched (same capture timing as the previous implementation).
      const actor: DownloadActor = {
        user: req.user,
        ip: req.ip,
        endpoint: req.originalUrl,
      };

      const getAction = getActionFactory(crowi, attachment);
      await getAction(req, res, { download: true });

      // Fire-and-forget (not awaited): the recording — snapshot construction
      // and pagePath resolution included — runs after the file response has
      // been dispatched and never delays it (requirements 7.1-7.4).
      recordDownloadActivity(crowi, attachment, actor);
    },
  );

  return router;
};
