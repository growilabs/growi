import type { IUser, IUserHasId } from '@growi/core';
import type { Request, Router } from 'express';
import express from 'express';
import { matchedData, query } from 'express-validator';
import mongoose from 'mongoose';

import type {
  IUserActivity,
  IUserActivityUser,
  UserActivitiesResult,
} from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/mongoose-utils';
import loginRequiredFactory from '~/server/middlewares/login-required';
import {
  aggregateUserActivities,
  buildListablePageFilter,
  type UserActivityRow,
} from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');

const MAX_LIMIT = 100;
const FALLBACK_LIMIT = 10;

const validator = {
  list: [
    query('limit')
      .optional()
      .isInt({ min: 1, max: MAX_LIMIT })
      .withMessage(`limit must be an integer between 1 and ${MAX_LIMIT}`)
      .toInt(),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('offset must be an integer greater than or equal to 0')
      .toInt(),
    query('targetUserId')
      .optional()
      .isMongoId()
      .withMessage('user ID must be a MongoDB ID'),
  ],
};

// loginRequiredStrictly lets a request through only when it has a user.
type UserActivitiesRequest = Request & { user: IUserHasId };

type UserActivitiesQuery = {
  limit?: number;
  offset?: number;
  targetUserId?: string;
};

// req.query is typed as raw strings, so the values converted by the
// validators are read back through matchedData and narrowed here.
const readValidatedQuery = (req: Request): UserActivitiesQuery => {
  const data: Record<string, unknown> = matchedData(req, {
    locations: ['query'],
  });
  const { limit, offset, targetUserId } = data;
  return {
    limit: typeof limit === 'number' ? limit : undefined,
    offset: typeof offset === 'number' ? offset : undefined,
    targetUserId: typeof targetUserId === 'string' ? targetUserId : undefined,
  };
};

type Paging = { totalDocs: number; limit: number; offset: number };

const findActivityUser = async (
  userId: string,
): Promise<IUserActivityUser | null> => {
  const user = await mongoose.model<IUser>('User').findById(userId);
  if (user == null) {
    return null;
  }
  return {
    _id: user._id.toString(),
    username: user.username,
    name: user.name,
    imageUrlCached: user.imageUrlCached ?? undefined,
  };
};

const buildPaginateResult = (
  docs: IUserActivity[],
  { totalDocs, limit, offset }: Paging,
): PaginateResult<IUserActivity> => {
  const totalPages = Math.ceil(totalDocs / limit);
  const page = Math.floor(offset / limit) + 1;
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;

  return {
    docs,
    totalDocs,
    limit,
    offset,
    page,
    totalPages,
    hasPrevPage,
    hasNextPage,
    prevPage: hasPrevPage ? page - 1 : null,
    nextPage: hasNextPage ? page + 1 : null,
    pagingCounter: offset + 1,
  };
};

const toUserActivity = (
  row: UserActivityRow,
  user: IUserActivityUser,
): IUserActivity => ({
  _id: row._id,
  action: row.action,
  createdAt: row.createdAt.toISOString(),
  user,
  target: row.target,
});

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     UserActivitiesResponse:
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
 *                       username:
 *                         type: string
 *                         example: "growi"
 *                       name:
 *                         type: string
 *                         example: "Taro"
 *                       imageUrlCached:
 *                         type: string
 *                         example: "/images/icons/user.svg"
 *                   target:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "675547e97f208f8050a361d4"
 *                       path:
 *                         type: string
 *                         example: "/Sandbox/page"
 *             totalDocs:
 *               type: integer
 *               example: 3
 *             limit:
 *               type: integer
 *               example: 10
 *             offset:
 *               type: integer
 *               example: 0
 *             page:
 *               type: integer
 *               example: 1
 *             totalPages:
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
 *             pagingCounter:
 *               type: integer
 *               example: 1
 */

export const setup = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const router = express.Router();

  /**
   * @swagger
   *
   * /user-activities:
   *   get:
   *     summary: /user-activities
   *     description: List the activities a user performed on pages that the requester is allowed to see, newest first
   *     tags: [Activity]
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - name: limit
   *         in: query
   *         required: false
   *         description: Number of rows to return. Defaults to the page-list size configured on the server.
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *       - name: offset
   *         in: query
   *         required: false
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *       - name: targetUserId
   *         in: query
   *         required: false
   *         description: MongoDB ObjectId of the user whose activities are listed. Defaults to the requester.
   *         schema:
   *           type: string
   *           example: "669a5aa48d45e62b521d00e4"
   *     responses:
   *       200:
   *         description: Activities fetched successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/UserActivitiesResponse'
   *       400:
   *         description: A query parameter is invalid
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 errors:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ErrorV3'
   *       403:
   *         description: The requester is not logged in
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *               example: Forbidden
   *       500:
   *         description: Failed to get user activities
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 errors:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ErrorV3'
   */
  router.get(
    '/',
    loginRequiredStrictly,
    validator.list,
    apiV3FormValidator,
    async (req: UserActivitiesRequest, res: ApiV3Response) => {
      const viewer = req.user;
      const validated = readValidatedQuery(req);
      const limit =
        validated.limit ??
        (configManager.getConfig('customize:showPageLimitationS') ||
          FALLBACK_LIMIT);
      const offset = validated.offset ?? 0;
      const targetUserId = validated.targetUserId ?? viewer._id.toString();

      try {
        const targetUser = await findActivityUser(targetUserId);
        if (targetUser == null) {
          const emptyResult: UserActivitiesResult = {
            serializedPaginationResult: buildPaginateResult([], {
              totalDocs: 0,
              limit,
              offset,
            }),
          };
          return res.apiv3(emptyResult);
        }

        const pageFilter = await buildListablePageFilter(viewer);
        const { docs, totalCount } = await aggregateUserActivities(prisma, {
          targetUserId,
          pageFilter,
          limit,
          offset,
        });

        const result: UserActivitiesResult = {
          serializedPaginationResult: buildPaginateResult(
            docs.map((row) => toUserActivity(row, targetUser)),
            { totalDocs: totalCount, limit, offset },
          ),
        };
        return res.apiv3(result);
      } catch (err) {
        // The cause can carry page ids and paths, so it is logged only.
        logger.error({ err }, 'Failed to get user activities');
        return res.apiv3Err('Failed to get user activities.', 500);
      }
    },
  );

  return router;
};
