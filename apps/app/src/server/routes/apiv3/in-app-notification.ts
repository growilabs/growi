import { SCOPE } from '@growi/core/dist/interfaces';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';

import type { IInAppNotification } from '../../../interfaces/in-app-notification';
import type { ApiV3Response } from './interfaces/apiv3-response';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     InAppNotificationListResponse:
 *       type: object
 *       properties:
 *         docs:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/InAppNotificationDocument'
 *         totalDocs:
 *           type: integer
 *           description: Total number of in app notification documents
 *         offset:
 *           type: integer
 *           description: Offset value
 *         limit:
 *           type: integer
 *           description: Limit per page
 *         totalPages:
 *           type: integer
 *           description: Total pages available
 *         page:
 *           type: integer
 *           description: Current page number
 *         hasPrevPage:
 *           type: boolean
 *           description: Indicator for previous page
 *         hasNextPage:
 *           type: boolean
 *           description: Indicator for next page
 *         prevPage:
 *           type: string
 *           description: Previous page number or null
 *         nextPage:
 *           type: string
 *           description: Next page number or null
 *     InAppNotificationDocument:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: In app notification document ID
 *         action:
 *           type: string
 *           description: Action performed on the in app notification document
 *         snapshot:
 *           type: string
 *           description: Snapshot details in JSON format
 *         target:
 *           $ref: '#/components/schemas/Page'
 *         user:
 *           $ref: '#/components/schemas/User'
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *         status:
 *           type: string
 *           description: Status of the in app notification document
 *         targetModel:
 *           type: string
 *           description: Model of the target
 *         id:
 *           type: string
 *           description: In app notification document ID
 *         actionUsers:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/User'
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(
    crowi,
  );
  const addActivity = generateAddActivityMiddleware();

  const inAppNotificationService = crowi.inAppNotificationService;

  const User = crowi.model('User');

  const activityEvent = crowi.event('activity');

  /**
   * @swagger
   *
   *  /in-app-notification/list:
   *    get:
   *      tags: [NotificationSetting]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /in-app-notification/list
   *      description: Get the list of in-app notifications
   *      parameters:
   *        - name: limit
   *          in: query
   *          description: The number of notifications to get
   *          schema:
   *            type: integer
   *        - name: offset
   *          in: query
   *          description: The number of notifications to skip
   *          schema:
   *            type: integer
   *        - name: status
   *          in: query
   *          description: The status to categorize. 'UNOPENED' or 'OPENED'.
   *          schema:
   *            type: string
   *      responses:
   *        200:
   *          description: The list of in-app notifications
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/InAppNotificationListResponse'
   */
  router.get(
    '/list',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // user must be set by loginRequiredStrictly
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const user = req.user!;

      const limit =
        req.query.limit != null
          ? parseInt(req.query.limit.toString()) || 10
          : 10;

      let offset = 0;
      if (req.query.offset != null) {
        offset = parseInt(req.query.offset.toString(), 10);
      }

      const queryOptions = {
        offset,
        limit,
      };

      // set in-app-notification status to categorize
      if (req.query.status != null) {
        Object.assign(queryOptions, { status: req.query.status });
      }

      const paginationResult =
        await inAppNotificationService.getLatestNotificationsByUser(
          user._id,
          queryOptions,
        );

      const getActionUsersFromActivities = (activities) =>
        activities
          .map(({ user }) => user)
          .filter((user, i, self) => self.indexOf(user) === i);

      const serializedDocs: Array<IInAppNotification> =
        paginationResult.docs.map((doc) => {
          if (doc.user != null && doc.user instanceof User) {
            doc.user = serializeUserSecurely(doc.user);
          }
          // To add a new property into mongoose doc, need to change the format of doc to an object
          const docObj: IInAppNotification = doc.toObject();
          const actionUsersNew = getActionUsersFromActivities(doc.activities);

          const serializedActionUsers = actionUsersNew.map((actionUser) => {
            return serializeUserSecurely(actionUser);
          });

          docObj.actionUsers = serializedActionUsers;
          return docObj;
        });

      const serializedPaginationResult = {
        ...paginationResult,
        docs: serializedDocs,
      };

      return res.apiv3(serializedPaginationResult);
    },
  );

  /**
   * @swagger
   *
   *  /in-app-notification/status:
   *    get:
   *      tags: [NotificationSetting]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /in-app-notification/status
   *      description: Get the status of in-app notifications
   *      responses:
   *        200:
   *          description: Get count of unread notifications
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  count:
   *                    type: integer
   *                    description: Count of unread notifications
   */
  router.get(
    '/status',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // user must be set by loginRequiredStrictly
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const user = req.user!;

      try {
        const count = await inAppNotificationService.getUnreadCountByUser(
          user._id,
        );
        return res.apiv3({ count });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   *  /in-app-notification/open:
   *    post:
   *      tags: [NotificationSetting]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /in-app-notification/open
   *      description: Open the in-app notification
   *      requestBody:
   *        content:
   *          application/json:
   *            schema:
   *              properties:
   *                id:
   *                  type: string
   *                  description: Notification ID
   *              required:
   *                - id
   *      responses:
   *        200:
   *          description: Notification opened successfully
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   */
  router.post(
    '/open',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // user must be set by loginRequiredStrictly
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const user = req.user!;

      const id = req.body.id;

      try {
        const notification = await inAppNotificationService.open(user, id);
        const result = { notification };
        return res.apiv3(result);
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   *  /in-app-notification/all-statuses-open:
   *    put:
   *      tags: [NotificationSetting]
   *      security:
   *        - bearer: []
   *        - accessTokenInQuery: []
   *      summary: /in-app-notification/all-statuses-open
   *      description: Open all in-app notifications
   *      responses:
   *        200:
   *          description: All notifications opened successfully
   */
  router.put(
    '/all-statuses-open',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    addActivity,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // user must be set by loginRequiredStrictly
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const user = req.user!;

      try {
        await inAppNotificationService.updateAllNotificationsAsOpened(user);

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_IN_APP_NOTIFICATION_ALL_STATUSES_OPEN,
        });

        return res.apiv3();
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  return router;
};
