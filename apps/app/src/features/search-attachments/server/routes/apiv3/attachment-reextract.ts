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
 *   + id validation
 *
 * Permission check (re-checked from the current Page grant on every request):
 *   - 400 if the id is not an ObjectId
 *   - 404 notfound_or_forbidden (one identical answer, see
 *     rules/page-write-action-403-404.md) if the attachment does not exist,
 *     has no page, the page is gone, or the caller is neither admin nor able
 *     to edit the page (= can view it, the same rule the attachment upload
 *     route applies)
 *   - 503 if the feature is disabled, or was enabled after boot (no indexer
 *     yet), or MAX_CONCURRENT_REEXTRACTIONS other attachments are being
 *     re-extracted
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

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageModel } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
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
 * One run may read the file, call the extractor and, on a busy answer, call
 * it once more, each call bounded by timeoutMs; this adds the time for the
 * storage read and the retry delay.
 */
const REEXTRACT_DEADLINE_MARGIN_MS = 30 * 1000;

/** Each run reads the whole file into memory and has it converted. */
const MAX_CONCURRENT_REEXTRACTIONS = 3;

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
 * @param crowi — supplies the indexer (set at boot only when the feature is
 *   enabled) and the search service, both read per request
 */
export function createAttachmentReextractRouter(crowi: Crowi): express.Router {
  const router = express.Router();
  const gate = createReextractGate<{ ok: boolean; outcome: ExtractionOutcome }>(
    MAX_CONCURRENT_REEXTRACTIONS,
  );

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const requireSearchAttachmentsEnabled = createRequireSearchAttachmentsEnabled(
    () => crowi.searchService?.isConfigured === true,
  );

  router.post(
    '/:id/reextract',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    requireSearchAttachmentsEnabled,
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
        const pageExists = (await Page.exists({ _id: pageId })) != null;
        if (!pageExists) {
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
        const running = gate.run(
          canonicalId,
          () => indexer.reindex(canonicalId),
          timeoutMs * 2 + REEXTRACT_DEADLINE_MARGIN_MS,
        );
        if (running == null) {
          return res.apiv3Err(
            new ErrorV3(
              'Too many attachments are being re-extracted; try again later',
              'reextract_busy',
            ),
            503,
          );
        }
        const result = await running;

        logger.info(
          {
            attachmentId,
            pageId,
            userId: user._id.toString(),
            outcome: result.outcome.kind,
          },
          'Attachment reextraction completed',
        );

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
