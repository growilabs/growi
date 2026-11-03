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
 *   - 404 if attachment not found
 *   - 403 if the attachment has no page, the page is gone, or the caller is
 *     neither admin nor able to edit the page (= can view it, the same rule
 *     the attachment upload route applies)
 *   - 503 if the feature is disabled, or was enabled after boot (no indexer yet)
 *   - 200 { outcome } on success
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
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { createRequireSearchAttachmentsEnabled } from '../../middlewares/require-search-attachments-enabled';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:attachment-reextract',
);

type Req = Request<{ id: string }, ApiV3Response, void> & {
  user?: IUserHasId;
};

// One answer for every denial, so it does not tell whether the page still exists.
const forbidden = (res: ApiV3Response) =>
  res.apiv3Err(
    new ErrorV3('Forbidden: insufficient permission', 'forbidden'),
    403,
  );

/**
 * @param crowi — supplies the indexer (set at boot only when the feature is
 *   enabled) and the search service, both read per request
 */
export function createAttachmentReextractRouter(crowi: Crowi): express.Router {
  const router = express.Router();

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
          return res.apiv3Err(
            new ErrorV3('Attachment not found', 'attachment_not_found'),
            404,
          );
        }

        const { pageId } = attachment;
        if (pageId == null) {
          return forbidden(res);
        }

        const Page = mongoose.model<IPage, PageModel>('Page');
        const pageExists = (await Page.exists({ _id: pageId })) != null;
        if (!pageExists) {
          return forbidden(res);
        }

        // Evaluated against the page's grant as stored right now
        const canEdit =
          user.admin === true ||
          (await Page.isAccessiblePageByViewer(pageId, user));
        if (!canEdit) {
          return forbidden(res);
        }

        const result = await indexer.reindex(attachmentId);

        logger.info(
          {
            attachmentId,
            pageId,
            userId: user._id.toString(),
            outcome: result.outcome.kind,
          },
          'Attachment reextraction completed',
        );

        return res.apiv3({ outcome: result.outcome });
      } catch (err) {
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
