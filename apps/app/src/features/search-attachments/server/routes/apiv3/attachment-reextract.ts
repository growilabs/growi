/**
 * POST /_api/v3/attachments/:id/reextract
 *
 * Re-extracts and re-indexes a single attachment's text content.
 *
 * Middleware chain:
 *   accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])
 *   + loginRequiredStrictly
 *   + excludeReadOnlyUser
 *   + requireSearchAttachmentsEnabled
 *   + addActivity (rules/activity-recording.md: a success records
 *     ACTION_ATTACHMENT_REEXTRACT, a later refusal or failure ACTION_UNSETTLED)
 *   + id validation
 *
 * Permission check (re-checked from the current Page grant on every request):
 *   - 400 if the id is not an ObjectId
 *   - 404 notfound_or_forbidden (one identical answer, see
 *     rules/page-write-action-403-404.md) if the attachment does not exist,
 *     has no page, the page is gone, or the caller is neither admin nor able
 *     to edit the page (= can view it, the same rule the attachment upload
 *     route applies)
 *   - 503 if the feature is disabled, or the run did not finish within its
 *     deadline (waiting for an extraction slot counts towards it)
 *   - 200 { outcome: { kind } } otherwise (ReextractResponse)
 *
 * Concurrent authorized requests for one attachment share one extraction.
 */

import type { IPage, IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import express from 'express';
import { param } from 'express-validator';
import mongoose from 'mongoose';

import { MODEL_ATTACHMENT, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageModel } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { buildAttachmentSnapshot } from '~/server/service/attachment/attachment-snapshot';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ExtractionOutcome,
  ReextractResponse,
} from '../../../interfaces/attachment-search';
import { createRequireSearchAttachmentsEnabled } from '../../middlewares/require-search-attachments-enabled';
import {
  createReextractGate,
  ReextractDeadlineError,
} from '../../services/reextract-gate';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:attachment-reextract',
);

type Req = Request<{ id: string }, ApiV3Response, void> & {
  user?: IUserHasId;
};

/**
 * The deadline is timeoutMs × 2 plus this margin. It does not cover the worst
 * case of one run (waiting for an extraction slot, then the file read, the
 * extractor call and its busy retry, each bounded by timeoutMs): such a run
 * answers 503 but keeps going, and a late success is still indexed.
 */
const REEXTRACT_DEADLINE_MARGIN_MS = 30 * 1000;

// One answer for every denial, so it tells neither whether the attachment
// nor whether its page exists.
const notFoundOrForbidden = (res: ApiV3Response) =>
  res.apiv3Err(
    new ErrorV3(
      'Attachment is not found or forbidden',
      'notfound_or_forbidden',
    ),
    404,
  );

/**
 * @param crowi — supplies the indexer (set at boot when the search service
 *   is configured) and the search service, both read per request
 */
export function createAttachmentReextractRouter(crowi: Crowi): express.Router {
  const router = express.Router();
  const gate = createReextractGate<{
    ok: boolean;
    outcome: ExtractionOutcome;
  }>();

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.events.activity;
  const requireSearchAttachmentsEnabled = createRequireSearchAttachmentsEnabled(
    () => crowi.searchService?.isConfigured === true,
  );

  router.post(
    '/:id/reextract',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    requireSearchAttachmentsEnabled,
    addActivity,
    param('id').isMongoId().withMessage('id must be an attachment id'),
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { id: attachmentId } = req.params;
      const { user } = req;

      // loginRequiredStrictly guarantees user is set, but type-narrow for safety
      if (user == null) {
        return res.apiv3Err(new ErrorV3('Unauthorized', 'unauthorized'), 401);
      }

      const indexer = crowi.attachmentSearchIndexer;
      if (indexer == null) {
        return res.apiv3Err(
          new ErrorV3(
            'Attachment full-text search feature is disabled',
            'feature_disabled',
          ),
          503,
        );
      }

      try {
        const attachment = await prisma.attachments.findUnique({
          where: { id: attachmentId },
        });
        if (attachment == null) {
          return notFoundOrForbidden(res);
        }

        const { pageId } = attachment;
        if (pageId == null) {
          return notFoundOrForbidden(res);
        }

        const Page = mongoose.model<IPage, PageModel>('Page');
        const page = await Page.findById(pageId).select('path').lean();
        if (page == null) {
          return notFoundOrForbidden(res);
        }

        // Evaluated against the page's grant as stored right now
        const canEdit =
          user.admin === true ||
          (await Page.isAccessiblePageByViewer(pageId, user));
        if (!canEdit) {
          return notFoundOrForbidden(res);
        }

        // The id as stored: the URL id may differ in hex case but names the
        // same attachment, and the gate must see one key for it.
        const canonicalId = attachment.id;
        const timeoutMs = configManager.getConfig(
          'app:attachmentFullTextSearch:timeoutMs',
        );
        const result = await gate.run(
          canonicalId,
          (signal) => indexer.reindex(canonicalId, { signal }),
          timeoutMs * 2 + REEXTRACT_DEADLINE_MARGIN_MS,
        );

        logger.info(
          {
            attachmentId,
            pageId,
            userId: user._id.toString(),
            outcome: result.outcome.kind,
          },
          'Attachment reextraction completed',
        );

        // emit before res.apiv3() — see rules/activity-recording.md
        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_ATTACHMENT_REEXTRACT,
          target: canonicalId,
          targetModel: MODEL_ATTACHMENT,
          snapshot: buildAttachmentSnapshot(
            {
              _id: canonicalId,
              originalName: attachment.originalName ?? undefined,
              fileSize: attachment.fileSize,
              pageId,
            },
            page.path,
            user.username,
          ),
        });

        const body: ReextractResponse = {
          outcome: { kind: result.outcome.kind },
        };
        return res.apiv3(body);
      } catch (err) {
        if (err instanceof ReextractDeadlineError) {
          logger.error({ attachmentId }, 'Attachment reextraction timed out');
          return res.apiv3Err(
            new ErrorV3(
              'Re-extraction did not finish in time; try again later',
              'reextract_timeout',
            ),
            503,
          );
        }
        logger.error(
          { err, attachmentId },
          'POST /:id/reextract: unexpected error',
        );
        return res.apiv3Err(
          new ErrorV3('Internal server error', 'internal_server_error'),
          500,
        );
      }
    },
  );

  return router;
}
