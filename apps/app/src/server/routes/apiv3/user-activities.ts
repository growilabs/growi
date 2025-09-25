import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import type { IActivity } from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';

import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');


const validator = {
  list: [
    query('limit').optional().isInt({ max: 100 }).withMessage('limit must be a number less than or equal to 100'),
    query('offset').optional().isInt().withMessage('page must be a number'),
    query('searchFilter').optional().isString().withMessage('query must be a string'),
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
 *                     example: "Page"
 *                   target:
 *                     type: string
 *                     example: "675547e97f208f8050a361d4"
 *                   action:
 *                     type: string
 *                     example: "PAGE_DELETE_COMPLETELY"
 *                   snapshot:
 *                     type: object
 *                     properties:
 *                       username:
 *                         type: string
 *                         example: "growi"
 *                       _id:
 *                         type: string
 *                         example: "67e33da5d97e8d3b53e99f96"
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

module.exports = (crowi: Crowi): Router => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);

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
  router.get('/:userId',

    // FIX: Need middleware for getting current users userId
    loginRequiredStrictly, validator.list, apiV3FormValidator, async(req: Request, res: ApiV3Response) => {

      const limit = req.query.limit || configManager.getConfig('customize:showPageLimitationS');
      const offset = req.query.offset || 1;
      const { userId } = req.params;
      const query = { user: userId };

      try {


        const userActivityPipeline = [
          {
            $match: {
              $and: [
                {
                  userId,
                },
                {
                  action: { $in: Object.values(ActivityLogActions) },
                },
              ],
            },
          },
          {
            $sort: {
              createdAt: -1 as const,
            },
          },
          {
            $limit: 20,
          },
        ];

        const simpleTestPipeline = [
          {
            $match: {
              action: 'UNSETTLED',
            },
          },
        ];
        const pipeLineResults = await Activity.aggregate(simpleTestPipeline);
        const test: string[] = [];

        return res.apiv3({ test });


        // Create paginateResult in MongoDB Aggregation Pipeline.
        const serializedDocs = paginateResult.docs.map((doc: IActivity) => {
          const { user, ...rest } = doc;
          return {
            user: serializeUserSecurely(user),
            ...rest,
          };
        });

        const serializedPaginationResult = {
          ...paginateResult,
          docs: serializedDocs,
        };

        return res.apiv3({ serializedPaginationResult });
      }
      catch (err) {
        logger.error('Failed to get paginated activity', err);
        return res.apiv3Err(err, 500);
      }
    });

  return router;
};
