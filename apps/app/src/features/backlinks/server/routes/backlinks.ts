import { SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { findUserGroupIdsForViewer } from '../services/find-user-group-ids-for-viewer';
import { isPageReadableByViewer } from '../services/is-page-readable-by-viewer';

const logger = loggerFactory('growi:routes:apiv3:backlink');

const getBacklinksHandler = (crowi: Crowi): RequestHandler => {
  return async (req: CrowiRequest, res: ApiV3Response) => {
    const { pageId } = req.query;

    // Guard needed for TypeScript type narrowing.
    // pageId is already validated and is always a string here.
    if (typeof pageId !== 'string') {
      return res.apiv3Err(
        new ErrorV3('pageId must be a string', 'invalid-page-id'),
        400,
      );
    }
    try {
      const pageObjectId = new mongoose.Types.ObjectId(pageId);
      const viewer = req.user ?? null;

      // Resolved once and shared by every viewer-filtered read below.
      const userGroups = await findUserGroupIdsForViewer(viewer);

      // Both reads assume the viewer can read this page: forward-link health returns
      // paths from its body. One 404 for "missing" and "forbidden" alike — see
      // rules/page-write-action-403-404.md.
      const isReadable = await isPageReadableByViewer(
        pageObjectId,
        viewer,
        userGroups,
      );

      if (!isReadable) {
        return res.apiv3Err(
          new ErrorV3(
            `Page '${pageId}' is not found or forbidden`,
            'notfound_or_forbidden',
          ),
          404,
        );
      }

      const [backlinks, linkTargets] = await Promise.all([
        crowi.pageLinkService.findBacklinks(pageObjectId, viewer, userGroups),
        crowi.pageLinkService.findForwardLinkHealth(
          pageObjectId,
          viewer,
          userGroups,
        ),
      ]);

      return res.apiv3({ backlinks, linkTargets });
    } catch (err) {
      logger.error({ err }, 'Failed to get backlinks');
      // Deliberately not forwarding `err`: apiv3Err serializes an Error's own
      // message to the client, which would leak driver/internal detail.
      return res.apiv3Err(
        new ErrorV3('Failed to get backlinks', 'failed-to-get-backlinks'),
        500,
      );
    }
  };
};

/**
 * @swagger
 *
 *    /page/backlinks:
 *      get:
 *        tags: [Page]
 *        summary: /page/backlinks
 *        description: >
 *          Get the pages that link to the given page, and the given page's outbound
 *          links whose target is trashed or broken. Sources the requesting user
 *          cannot read, and sources in the trash, are omitted.
 *        parameters:
 *          - name: pageId
 *            in: query
 *            required: true
 *            description: id of the page to list backlinks for
 *            schema:
 *              $ref: '#/components/schemas/ObjectId'
 *        responses:
 *          200:
 *            description: Successfully retrieved the backlinks.
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    backlinks:
 *                      type: array
 *                      description: Readable, non-trashed pages linking to this page
 *                      items:
 *                        type: object
 *                        properties:
 *                          pageId:
 *                            $ref: '#/components/schemas/ObjectId'
 *                          path:
 *                            type: string
 *                            description: current path of the linking page
 *                            example: /Sandbox/source
 *                    linkTargets:
 *                      type: array
 *                      description: >
 *                        This page's outbound links whose target is trashed or broken.
 *                        Links to healthy pages, and to trashed pages the requesting
 *                        user cannot read, are omitted.
 *                      items:
 *                        type: object
 *                        properties:
 *                          pageId:
 *                            type: string
 *                            nullable: true
 *                            description: id of the trashed target page; null when broken
 *                          path:
 *                            type: string
 *                            description: >
 *                              current path of a trashed target, or the link's own path
 *                              when broken
 *                            example: /trash/Sandbox/target
 *                          targetState:
 *                            type: string
 *                            enum: [trashed, broken]
 *          400:
 *            description: pageId is missing or is not a MongoDB ID.
 *          404:
 *            description: The page does not exist or the requesting user cannot read it.
 *          500:
 *            description: Internal server error.
 */
export const getBacklinksHandlerFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, true);

  const validator: ValidationChain[] = [
    query('pageId')
      .notEmpty()
      .withMessage('pageId is required')
      .isMongoId()
      .withMessage('pageId must be a MongoDB ID'),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    loginRequired,
    ...validator,
    apiV3FormValidator,
    getBacklinksHandler(crowi),
  ];
};
