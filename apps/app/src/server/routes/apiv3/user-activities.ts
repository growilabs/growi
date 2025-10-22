import type { IUserHasId } from '@growi/core';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';
import type { PipelineStage, PaginateResult } from 'mongoose';
import { Types } from 'mongoose';

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
    query('limit').optional().isInt({ max: 100 }).withMessage('limit must be a number less than or equal to 100')
      .toInt(),
    query('offset').optional().isInt().withMessage('page must be a number')
      .toInt(),
    query('searchFilter').optional().isString().withMessage('query must be a string'),
  ],
};

interface StrictActivityQuery {
  limit?: number;
  offset?: number;
  searchFilter?: string;
}

type CustomRequest<
  TQuery = Request['query'],
  TBody = any,
  TParams = any
> = Omit<Request<TParams, any, TBody, TQuery>, 'query'> & {
    query: TQuery & Request['query'];
    user?: IUserHasId;
};

type AuthorizedRequest = CustomRequest<StrictActivityQuery>;

type ActivityPaginationResult = PaginateResult<IActivity>;


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
 *                   targetModel:
 *                     type: string
 *                     example: "Page"
 *                   target:
 *                     type: string
 *                     example: "675547e97f208f8050a361d4"
 *                   action:
 *                     type: string
 *                     example: "PAGE_UPDATE"
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     example: "2025-03-25T23:35:01.584Z"
 *                   user:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "669a5aa48d45e62b521d00e4"
 *                       name:
 *                         type: string
 *                         example: "Taro"
 *                       username:
 *                         type: string
 *                         example: "growi"
 *                       imageUrlCached:
 *                         type: string
 *                         example: "/images/icons/user.svg"
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
   *       - cookieAuth: []
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
  router.get('/',
    loginRequiredStrictly, validator.list, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response) => {

      const defaultLimit = configManager.getConfig('customize:showPageLimitationS');

      const limit = req.query.limit || defaultLimit || 10;
      const offset = req.query.offset || 0;

      const user = req.user;

      if (!user || !user._id) {
        logger.error('Authentication failure: req.user is missing after loginRequiredStrictly.');
        return res.apiv3Err('Authentication failed.', 401);
      }

      const userId = user._id;

      try {
        const userObjectId = new Types.ObjectId(userId);

        const userActivityPipeline: PipelineStage[] = [
          {
            $match: {
              user: userObjectId,
              action: { $in: Object.values(ActivityLogActions) },
            },
          },
          {
            $facet: {
              totalCount: [
                { $count: 'count' },
              ],
              docs: [
                { $sort: { createdAt: -1 } },
                { $skip: offset },
                { $limit: limit },
                {
                  $lookup: {
                    from: 'pages',
                    localField: 'target',
                    foreignField: '_id',
                    as: 'target',
                  },
                },
                {
                  $unwind: {
                    path: '$target',
                    preserveNullAndEmptyArrays: true,
                  },
                },
                {
                  $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'user',
                  },
                },
                {
                  $unwind: {
                    path: '$user',
                    preserveNullAndEmptyArrays: true,
                  },
                },
                {
                  $project: {
                    _id: 1,
                    'user._id': 1,
                    'user.username': 1,
                    'user.name': 1,
                    'user.imageUrlCached': 1,
                    action: 1,
                    createdAt: 1,
                    target: 1,
                    targetModel: 1,
                  },
                },
              ],
            },
          },
        ];

        const [activityResults] = await Activity.aggregate(userActivityPipeline);

        const serializedResults = activityResults.docs.map((doc: IActivity) => {
          const { user, ...rest } = doc;
          return {
            user: serializeUserSecurely(user),
            ...rest,
          };
        });

        const totalDocs = activityResults.totalCount.length > 0 ? activityResults.totalCount[0].count : 0;
        const totalPages = Math.ceil(totalDocs / limit);
        const page = Math.floor(offset / limit) + 1;

        const nextPage = page < totalPages ? page + 1 : null;
        const prevPage = page > 1 ? page - 1 : null;
        const pagingCounter = offset + 1;

        const serializedPaginationResult: ActivityPaginationResult = {
          docs: serializedResults,
          totalDocs,
          limit,
          offset,
          page,
          totalPages,
          hasPrevPage: page > 1,
          hasNextPage: page < totalPages,
          nextPage,
          prevPage,
          pagingCounter,
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
