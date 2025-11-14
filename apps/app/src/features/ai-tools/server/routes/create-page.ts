import {
  GroupType,
  type IUser,
  type IUserHasId,
  SCOPE,
} from '@growi/core/dist/interfaces';
import { isUserPage } from '@growi/core/dist/utils/page-path-utils';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { IApiv3PageCreateParams } from '~/interfaces/apiv3';
import type { IOptionsForCreate } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import type { PageDocument } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import {
  determineBodyAndTags,
  postAction,
  saveTags,
} from '~/server/routes/apiv3/page/create-page-helpers';
import loggerFactory from '~/utils/logger';

import { determinePath } from '../services/create-page';

const logger = loggerFactory('growi:routes:apiv3:ai-tools:create-page');

type ReqBody = IApiv3PageCreateParams & {
  todaysMemoTitle?: string;
  pathHintKeywords?: string[];
};

type CreatePageReq = Request<undefined, ApiV3Response, ReqBody> & {
  user: IUserHasId;
};

type CreatePageFactory = (crowi: Crowi) => RequestHandler[];

export const createPageHandlersFactory: CreatePageFactory = (crowi) => {
  const User = mongoose.model<IUser, { isExistUserByUserPagePath: any }>(
    'User',
  );

  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    body('path').optional().isString().withMessage('"path" must be string'),

    body('todaysMemoTitle')
      .optional()
      .isString()
      .withMessage('"todaysMemoTitle" must be string'),

    body('pathHintKeywords')
      .optional()
      .isArray()
      .withMessage('"pathHintKeywords" must be array'),

    body('body').isString().withMessage('"body" must be string'),

    body('grant')
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage('"grant" must be integer from 1 to 5'),

    body('grantUserGroupIds')
      .optional()
      .isArray()
      .withMessage('"grantUserGroupIds" must be array'),

    body('grantUserGroupIds.*.type')
      .optional()
      .isIn([GroupType.userGroup, GroupType.externalUserGroup])
      .withMessage(
        '"grantUserGroupIds.*.type" must be either "userGroup" or "externalUserGroup"',
      ),

    body('grantUserGroupIds.*.item')
      .optional()
      .isMongoId()
      .withMessage(
        '"grantUserGroupIds.*.item" must be a valid MongoDB ObjectId',
      ),

    body('onlyInheritUserRelatedGrantedGroups')
      .optional()
      .isBoolean()
      .withMessage('onlyInheritUserRelatedGrantedGroups must be boolean'),

    body('overwriteScopesOfDescendants')
      .optional()
      .isBoolean()
      .withMessage('overwriteScopesOfDescendants must be boolean'),

    body('pageTags').optional().isArray().withMessage('pageTags must be array'),

    body('isSlackEnabled')
      .optional()
      .isBoolean()
      .withMessage('isSlackEnabled must be boolean'),

    body('slackChannels')
      .optional()
      .isString()
      .withMessage('slackChannels must be string'),

    body('wip').optional().isBoolean().withMessage('wip must be boolean'),
  ];

  const addActivity = generateAddActivityMiddleware();

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT]), // TODO: https://redmine.weseek.co.jp/issues/172491
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    validator,
    apiV3FormValidator,
    async (req: CreatePageReq, res: ApiV3Response) => {
      const {
        path,
        todaysMemoTitle,
        pathHintKeywords,
        body,
        grant,
        grantUserGroupIds,
        pageTags,
        onlyInheritUserRelatedGrantedGroups,
        overwriteScopesOfDescendants,
        wip,
      } = req.body;

      if (
        path == null &&
        todaysMemoTitle == null &&
        (pathHintKeywords == null || pathHintKeywords.length === 0)
      ) {
        return res.apiv3Err(
          'Either "path", "todaysMemoTitle" or "pathHintKeywords" is required',
          400,
        );
      }

      let pathToCreate: string;
      try {
        pathToCreate = await determinePath(
          req.user,
          path,
          todaysMemoTitle,
          pathHintKeywords,
        );
      } catch (err) {
        logger.error(err);
        return res.apiv3Err('Could not determine page path', 400);
      }

      if (isUserPage(pathToCreate)) {
        const isExistUser = await User.isExistUserByUserPagePath(pathToCreate);
        if (!isExistUser) {
          return res.apiv3Err(
            "Unable to create a page under a non-existent user's user page",
          );
        }
      }

      const { body: determinedBody, tags: determinedTags } =
        await determineBodyAndTags(pathToCreate, body, pageTags);

      let createdPage: HydratedDocument<PageDocument>;
      try {
        const options: IOptionsForCreate = {
          onlyInheritUserRelatedGrantedGroups,
          overwriteScopesOfDescendants,
          wip,
        };

        if (grant != null) {
          options.grant = grant;
          options.grantUserGroupIds = grantUserGroupIds;
        }

        createdPage = await crowi.pageService.create(
          pathToCreate,
          determinedBody,
          req.user,
          options,
        );
      } catch (err) {
        logger.error('Error occurred while creating a page.', err);
        return res.apiv3Err(err);
      }

      await saveTags({ createdPage, pageTags: determinedTags }, crowi);

      // TODO: https://redmine.weseek.co.jp/issues/173816
      res.apiv3({}, 201);

      postAction(req, res, createdPage, crowi);
    },
  ];
};
