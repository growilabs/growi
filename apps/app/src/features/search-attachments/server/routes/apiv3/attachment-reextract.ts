/**
 * POST /_api/v3/attachments/:id/reextract
 *
 * Re-extracts and re-indexes a single attachment's text content.
 *
 * Middleware chain:
 *   accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT])
 *   + loginRequiredStrictly
 *   + requireSearchAttachmentsEnabled
 *
 * Permission check (re-checked from current DB grant, not session cache):
 *   - 404 if attachment not found
 *   - 403 if page not found (orphan attachment, no editor)
 *   - 403 if caller is neither admin nor page editor (in grantedUsers or public page)
 *   - 200 { outcome } on success
 */

import type { IPage, IUserHasId } from '@growi/core';
import { PageGrant, SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import express from 'express';
import mongoose from 'mongoose';

import type { AttachmentSearchIndexer } from '~/features/search-attachments/server/services/attachment-search-indexer';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { Attachment } from '~/server/models/attachment';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { createRequireSearchAttachmentsEnabled } from '../../middlewares/require-search-attachments-enabled';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:attachment-reextract',
);

type Req = Request<{ id: string }, ApiV3Response, void> & {
  user?: IUserHasId;
};

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

/**
 * Returns true when the user has edit access to the page based on current grant.
 *
 * A user is considered a page editor when:
 * - The page grant is GRANT_PUBLIC (anyone can edit)
 * - The page grant is GRANT_SPECIFIED / GRANT_OWNER and the user's _id
 *   appears in page.grantedUsers
 *
 * Group-based grants are intentionally excluded from this check to keep
 * the logic simple and avoid requiring group resolution.
 */
function isPageEditor(
  page: { grant: number; grantedUsers: unknown[] },
  userId: string,
): boolean {
  if (page.grant === PageGrant.GRANT_PUBLIC) {
    return true;
  }

  // For GRANT_SPECIFIED (deprecated), GRANT_OWNER, GRANT_RESTRICTED —
  // check if user._id is listed in grantedUsers.
  return page.grantedUsers.some((u) => {
    if (u == null) return false;
    // u may be an ObjectId, a populated user object, or a string
    const id =
      typeof u === 'object' && '_id' in (u as Record<string, unknown>)
        ? String((u as Record<string, unknown>)._id)
        : String(u);
    return id === userId;
  });
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAttachmentReextractRouter(
  crowi: Crowi,
  indexer: AttachmentSearchIndexer,
  isSearchServiceConfigured: () => boolean,
): express.Router {
  const router = express.Router();

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const requireSearchAttachmentsEnabled = createRequireSearchAttachmentsEnabled(
    isSearchServiceConfigured,
  );

  router.post(
    '/:id/reextract',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT]),
    loginRequiredStrictly,
    requireSearchAttachmentsEnabled,
    async (req: Req, res: ApiV3Response) => {
      const { id: attachmentId } = req.params;
      const { user } = req;

      // loginRequiredStrictly guarantees user is set, but type-narrow for safety
      if (user == null) {
        return res.apiv3Err(new ErrorV3('Unauthorized', 'unauthorized'), 401);
      }

      try {
        // Step 1: load attachment
        const attachment = await Attachment.findById(attachmentId);
        if (attachment == null) {
          return res.apiv3Err(
            new ErrorV3('Attachment not found', 'attachment_not_found'),
            404,
          );
        }

        // Step 2: load parent page
        const pageId =
          attachment.page != null ? attachment.page.toString() : null;
        if (pageId == null) {
          // Orphan attachment (not linked to a page) — no editor, deny access
          return res.apiv3Err(
            new ErrorV3(
              'Forbidden: orphan attachment has no page editor',
              'forbidden',
            ),
            403,
          );
        }

        const Page = mongoose.model<IPage, PageModel>('Page');
        const page = await Page.findById(pageId);
        if (page == null) {
          // Page not found — treat as orphan
          return res.apiv3Err(
            new ErrorV3('Forbidden: parent page not found', 'forbidden'),
            403,
          );
        }

        // Step 3: permission check — admin OR page editor (re-checked from DB)
        const userId = user._id.toString();
        const isAdmin = user.admin === true;
        const hasEditAccess = isAdmin || isPageEditor(page, userId);

        if (!hasEditAccess) {
          return res.apiv3Err(
            new ErrorV3('Forbidden: insufficient permission', 'forbidden'),
            403,
          );
        }

        // Step 4: re-extract and re-index
        const result = await indexer.reindex(attachmentId);

        logger.info(
          { attachmentId, pageId, userId, outcome: result.outcome.kind },
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
