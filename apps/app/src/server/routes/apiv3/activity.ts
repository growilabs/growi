import { SCOPE } from '@growi/core/dist/interfaces';
import type { NextFunction, Request, Router } from 'express';
import express from 'express';
import { body, query } from 'express-validator';

import {
  AUDITLOG_SUGGESTION_FIELDS,
  type AuditlogSuggestionField,
  type AuditlogSuggestionsResponse,
  type ISearchFilter,
  isAuditlogSuggestionField,
} from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import {
  paginateAndSerializeActivities,
  resolveActivityListWhere,
} from './fetch-activity-list';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');

interface ISuggestionsRequest
  extends Request<
    undefined,
    undefined,
    undefined,
    { field?: string | string[]; q?: string; limit?: number }
  > {}

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
  suggestions: [
    query('field')
      .optional()
      .custom((value) => {
        const values = Array.isArray(value) ? value : [value];
        return values.every(isAuditlogSuggestionField);
      })
      .withMessage(
        `field must be one or more of: ${AUDITLOG_SUGGESTION_FIELDS.join(', ')}`,
      ),
    query('q')
      .optional()
      .isString()
      .isLength({ max: 100 })
      .withMessage('q must be a string'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt()
      .withMessage('limit must be a number less than or equal to 100'),
  ],
  // POST /activity/list carries the same parameters in the request body so the
  // searchFilter (which lists every selected action) never bloats the URL.
  listByPost: [
    body('limit')
      .optional()
      .isInt({ max: 100 })
      .withMessage('limit must be a number less than or equal to 100'),
    body('offset').optional().isInt().withMessage('offset must be a number'),
    body('searchFilter')
      .optional()
      .isObject()
      .withMessage('searchFilter must be an object'),
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

  // Shared gate for every list transport: 405 when the audit log is disabled.
  // Kept as one middleware so the GET and POST routes cannot drift apart.
  const ensureAuditLogEnabled = (
    _req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    if (!configManager.getConfig('app:auditLogEnabled')) {
      const msg = 'AuditLog is not enabled';
      logger.error(msg);
      return res.apiv3Err(msg, 405);
    }
    next();
  };

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
    ensureAuditLogEnabled,
    async (req: Request, res: ApiV3Response) => {
      const limit =
        req.query.limit ||
        configManager.getConfig('customize:showPageLimitationS');
      // Preserve the existing offset || 1 quirk exactly (pure migration, req 2.1):
      // an absent offset is falsy and becomes 1, skipping the first record. This
      // behaviour is intentional to maintain observational parity before a
      // separate fix is landed. Note: a query string turns an explicit offset=0
      // into the truthy "0", so page 1 (offset=0) is NOT skipped here — only a
      // fully absent offset is. The POST route below must reproduce that.
      const offset = req.query.offset || 1;

      let where: ReturnType<typeof resolveActivityListWhere> = {};
      try {
        const parsedSearchFilter = JSON.parse(
          req.query.searchFilter as string,
        ) as ISearchFilter;
        where = resolveActivityListWhere(
          crowi.activityService.getAvailableActions(false),
          parsedSearchFilter,
        );
      } catch (err) {
        logger.error('Invalid value', err);
        return res.apiv3Err(err, 400);
      }

      try {
        const serializedPaginationResult = await paginateAndSerializeActivities(
          where,
          limit as number,
          offset as number,
        );
        return res.apiv3({ serializedPaginationResult });
      } catch (err) {
        logger.error('Failed to get paginated activity', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   * /activity/list:
   *   post:
   *     summary: /activity/list
   *     description: >-
   *       Same as `GET /activity` but takes limit / offset / searchFilter in the
   *       request body. The audit-log UI uses this so the searchFilter (which
   *       lists every selected action) never bloats the query string and hits a
   *       URL-length limit for large action-group configurations.
   *     tags: [Activity]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *       - accessTokenHeaderAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               limit:
   *                 type: integer
   *               offset:
   *                 type: integer
   *               searchFilter:
   *                 type: object
   *                 properties:
   *                   usernames:
   *                     type: array
   *                     items:
   *                       type: string
   *                   actions:
   *                     type: array
   *                     description: >-
   *                       Omit this field to match every activity. Send it only
   *                       to restrict the result to the listed actions.
   *                     items:
   *                       type: string
   *                   dates:
   *                     type: object
   *                     properties:
   *                       startDate:
   *                         type: string
   *                         nullable: true
   *                       endDate:
   *                         type: string
   *                         nullable: true
   *     responses:
   *       200:
   *         description: Activity fetched successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ActivityResponse'
   */
  router.post(
    '/list',
    accessTokenParser([SCOPE.READ.ADMIN.AUDIT_LOG], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.listByPost,
    apiV3FormValidator,
    ensureAuditLogEnabled,
    async (req: Request, res: ApiV3Response) => {
      const limit =
        req.body.limit ||
        configManager.getConfig('customize:showPageLimitationS');
      // The body carries a real numeric offset, so 0 MUST mean "no skip" (page 1
      // shows the newest record). The GET route's `offset || 1` quirk only
      // survives there because the query string turns 0 into the truthy "0";
      // applying `|| 1` to a numeric 0 here would wrongly skip the newest record.
      const offset = req.body.offset ?? 0;
      const parsedSearchFilter = (req.body.searchFilter ?? {}) as ISearchFilter;

      let where: ReturnType<typeof resolveActivityListWhere>;
      try {
        where = resolveActivityListWhere(
          crowi.activityService.getAvailableActions(false),
          parsedSearchFilter,
        );
      } catch (err) {
        logger.error('Invalid value', err);
        return res.apiv3Err(err, 400);
      }

      try {
        const serializedPaginationResult = await paginateAndSerializeActivities(
          where,
          limit as number,
          offset as number,
        );
        return res.apiv3({ serializedPaginationResult });
      } catch (err) {
        logger.error('Failed to get paginated activity', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   * /activity/suggestions:
   *   get:
   *     summary: /activity/suggestions
   *     tags: [Activity]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *     parameters:
   *       - name: field
   *         in: query
   *         required: false
   *         schema:
   *           type: string
   *           enum: [username]
   *       - name: q
   *         in: query
   *         required: false
   *         schema:
   *           type: string
   *       - name: limit
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Suggestions fetched successfully
   */
  router.get(
    '/suggestions',
    accessTokenParser([SCOPE.READ.ADMIN.AUDIT_LOG], { acceptLegacy: true }),
    loginRequiredStrictly,
    adminRequired,
    validator.suggestions,
    apiV3FormValidator,
    // biome-ignore lint/suspicious/noTsIgnore: Suppress auto fix by lefthook
    // @ts-ignore - Scope type causes "Type instantiation is excessively deep" with tsgo
    async (req: ISuggestionsRequest, res: ApiV3Response) => {
      const { field, q = '', limit = 5 } = req.query;

      const fields: AuditlogSuggestionField[] =
        field == null
          ? [...AUDITLOG_SUGGESTION_FIELDS]
          : (Array.isArray(field) ? field : [field]).filter(
              isAuditlogSuggestionField,
            );

      const { searchService } = crowi;

      if (!searchService.isConfigured) {
        return res.apiv3({} satisfies AuditlogSuggestionsResponse);
      }

      try {
        const result = await searchService.searchAuditlogSuggestions(
          fields,
          q,
          limit,
        );
        return res.apiv3(result);
      } catch (err) {
        logger.error('Failed to get suggestions', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  return router;
};
