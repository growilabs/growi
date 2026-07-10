import { SCOPE } from '@growi/core/dist/interfaces';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { isValid } from 'date-fns/isValid';
import { parseISO } from 'date-fns/parseISO';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import type { Prisma } from '~/generated/prisma/client';
import type { ISearchFilter } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import { buildActivityListWhere } from './build-activity-list-where';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');

const validator = {
  list: [
    query('limit')
      .optional()
      .isInt({ max: 100 })
      .withMessage('limit must be a number less than or equal to 100'),
    query('offset').optional().isInt().withMessage('page must be a number'),
    query('searchFilter')
      .optional()
      .isString()
      .withMessage('query must be a string'),
  ],
};

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     ActivityResponse:
 *       type: object
 *       properties:
 *         serializedPaginationResult:
 *           type: object
 *           properties:
 *             docs:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     example: "67e33da5d97e8d3b53e99f95"
 *                   id:
 *                     type: string
 *                     example: "67e33da5d97e8d3b53e99f95"
 *                   ip:
 *                     type: string
 *                     example: "::ffff:172.18.0.1"
 *                   endpoint:
 *                     type: string
 *                     example: "/_api/pages.remove"
 *                   targetModel:
 *                     type: string
 *                     description: >-
 *                       Model name of the activity target. For attachment
 *                       activities (ATTACHMENT_ADD / ATTACHMENT_REMOVE /
 *                       ATTACHMENT_DOWNLOAD) this is "Attachment".
 *                     example: "Page"
 *                   target:
 *                     type: string
 *                     description: >-
 *                       ID of the activity target. For attachment activities
 *                       this is the attachment ID; combined with the snapshot
 *                       fields it lets consumers build a download link for
 *                       attachments that still exist (ATTACHMENT_ADD /
 *                       ATTACHMENT_DOWNLOAD, distinguished by `action`).
 *                     example: "675547e97f208f8050a361d4"
 *                   action:
 *                     type: string
 *                     example: "PAGE_DELETE_COMPLETELY"
 *                   snapshot:
 *                     type: object
 *                     properties:
 *                       username:
 *                         type: string
 *                         description: >-
 *                           Username of the operator. Omitted when the activity
 *                           was recorded without an authenticated user (e.g.
 *                           guest ATTACHMENT_DOWNLOAD).
 *                         example: "growi"
 *                       _id:
 *                         type: string
 *                         example: "67e33da5d97e8d3b53e99f96"
 *                       originalName:
 *                         type: string
 *                         description: >-
 *                           Original file name of the attachment.
 *                           Present on attachment activities (ATTACHMENT_ADD /
 *                           ATTACHMENT_REMOVE / ATTACHMENT_DOWNLOAD).
 *                         example: "design-v2.pdf"
 *                       pagePath:
 *                         type: string
 *                         description: >-
 *                           Path of the page the attachment belongs or belonged
 *                           to. Present on attachment activities (ATTACHMENT_ADD /
 *                           ATTACHMENT_REMOVE / ATTACHMENT_DOWNLOAD) when it
 *                           could be resolved at capture time.
 *                         example: "/Sandbox/attachments"
 *                       pageId:
 *                         type: string
 *                         description: >-
 *                           ID of the page the attachment belongs or belonged
 *                           to. Present on attachment activities (ATTACHMENT_ADD /
 *                           ATTACHMENT_REMOVE / ATTACHMENT_DOWNLOAD).
 *                         example: "675547e97f208f8050a361d4"
 *                       fileSize:
 *                         type: integer
 *                         description: >-
 *                           File size in bytes of the attachment.
 *                           Present on attachment activities (ATTACHMENT_ADD /
 *                           ATTACHMENT_REMOVE / ATTACHMENT_DOWNLOAD).
 *                         example: 12345
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     example: "2025-03-25T23:35:01.584Z"
 *                   __v:
 *                     type: integer
 *                     example: 0
 *                   user:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "669a5aa48d45e62b521d00e4"
 *                       isGravatarEnabled:
 *                         type: boolean
 *                         example: false
 *                       isEmailPublished:
 *                         type: boolean
 *                         example: true
 *                       lang:
 *                         type: string
 *                         example: "ja_JP"
 *                       status:
 *                         type: integer
 *                         example: 2
 *                       admin:
 *                         type: boolean
 *                         example: true
 *                       readOnly:
 *                         type: boolean
 *                         example: false
 *                       isInvitationEmailSended:
 *                         type: boolean
 *                         example: false
 *                       name:
 *                         type: string
 *                         example: "Taro"
 *                       username:
 *                         type: string
 *                         example: "grow"
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-07-19T12:23:00.806Z"
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-03-25T23:34:04.362Z"
 *                       __v:
 *                         type: integer
 *                         example: 0
 *                       imageUrlCached:
 *                         type: string
 *                         example: "/images/icons/user.svg"
 *                       lastLoginAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-03-25T23:34:04.355Z"
 *                       email:
 *                         type: string
 *                         example: "test@example.com"
 *             totalDocs:
 *               type: integer
 *               example: 3
 *             offset:
 *               type: integer
 *               example: 0
 *             limit:
 *               type: integer
 *               example: 10
 *             totalPages:
 *               type: integer
 *               example: 1
 *             page:
 *               type: integer
 *               example: 1
 *             pagingCounter:
 *               type: integer
 *               example: 1
 *             hasPrevPage:
 *               type: boolean
 *               example: false
 *             hasNextPage:
 *               type: boolean
 *               example: false
 *             prevPage:
 *               type: integer
 *               nullable: true
 *               example: null
 *             nextPage:
 *               type: integer
 *               nullable: true
 *               example: null
 */

export const setup = (crowi: Crowi): Router => {
  const adminRequired = adminRequiredFactory(crowi);
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const router = express.Router();

  /**
   * @swagger
   *
   * /activity:
   *   get:
   *     summary: /activity
   *     tags: [Activity]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *       - accessTokenHeaderAuth: []
   *     parameters:
   *       - name: limit
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *       - name: offset
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *       - name: searchFilter
   *         in: query
   *         required: false
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Activity fetched successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ActivityResponse'
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.AUDIT_LOG], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.list,
    apiV3FormValidator,
    async (req: Request, res: ApiV3Response) => {
      const auditLogEnabled = configManager.getConfig('app:auditLogEnabled');
      if (!auditLogEnabled) {
        const msg = 'AuditLog is not enabled';
        logger.error(msg);
        return res.apiv3Err(msg, 405);
      }

      const limit =
        req.query.limit ||
        configManager.getConfig('customize:showPageLimitationS');
      // Preserve the existing offset || 1 quirk exactly (pure migration, req 2.1):
      // When the frontend sends offset=0 for page 1, it is falsy and becomes 1,
      // skipping the first record. This behaviour is intentional to maintain
      // observational parity before a separate fix is landed.
      const offset = req.query.offset || 1;

      let where: ReturnType<typeof buildActivityListWhere> = {};

      try {
        const parsedSearchFilter = JSON.parse(
          req.query.searchFilter as string,
        ) as ISearchFilter;

        // resolve action filter: only include actions that are actually available
        let searchableActions: string[] | undefined;
        if (parsedSearchFilter.actions != null) {
          const availableActions =
            crowi.activityService.getAvailableActions(false);
          searchableActions = parsedSearchFilter.actions.filter((action) =>
            availableActions.includes(action),
          );
        }

        // parse date range
        const startDate = parseISO(parsedSearchFilter?.dates?.startDate || '');
        const endDate = parseISO(parsedSearchFilter?.dates?.endDate || '');

        where = buildActivityListWhere({
          usernames: parsedSearchFilter.usernames,
          actions: searchableActions,
          startDate: isValid(startDate) ? startDate : undefined,
          endDate: isValid(endDate) ? endDate : undefined,
        });
      } catch (err) {
        logger.error('Invalid value', err);
        return res.apiv3Err(err, 400);
      }

      try {
        const paginateResult = await prisma.activities.paginate({
          where,
          orderBy: { createdAt: 'desc' },
          offset: offset as number,
          limit: limit as number,
          include: { user: true },
        });

        // Remap each doc to match the old Mongoose response shape (req 2.3):
        // - drop `userId` (not present in old Mongoose docs)
        // - keep serialized `user` (populated relation, same as Mongoose populate)
        // - keep _id/__v (computed fields) and all other scalar fields
        //
        // Type note: the `paginate` generic resolves via PaginateOptions<…> which
        // does not propagate `include` into the result type, so `docs` is typed as
        // the base scalar shape (no `user` property). We route through `unknown`
        // to reach the correct payload type — this is the Tier-2 cast rationale:
        // the cast is confined to the map boundary; the underlying runtime value
        // is correct because `include: { user: true }` was passed to `paginate`.
        type ActivityWithUser = Prisma.activitiesGetPayload<{
          include: { user: true };
        }>;
        const serializedDocs = (
          paginateResult.docs as unknown as ActivityWithUser[]
        ).map((doc) => {
          const { user, userId, ...rest } = doc;
          return {
            // The Prisma `users` type has nullable fields (e.g. name: string|null)
            // while `IUser` requires non-nullable. At runtime they map to the same
            // MongoDB document. Cast to Ref<IUser> so serializeUserSecurely resolves.
            // Tier-2 rationale: cast is confined to this single field expression.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            user: serializeUserSecurely(user as any),
            ...rest,
          };
        });

        const serializedPaginationResult = {
          ...paginateResult,
          docs: serializedDocs,
        };

        return res.apiv3({ serializedPaginationResult });
      } catch (err) {
        logger.error('Failed to get paginated activity', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  return router;
};
