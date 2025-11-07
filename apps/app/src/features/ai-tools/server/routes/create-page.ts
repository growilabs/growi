import { GroupType, type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import {
  isCreatablePage,
  userHomepagePath,
} from '@growi/core/dist/utils/page-path-utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { format } from 'date-fns/format';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';

import type { IApiv3PageCreateParams } from '~/interfaces/apiv3';
import type { IOptionsForCreate } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import {
  determineBodyAndTags,
  postAction,
  saveTags,
} from '~/server/routes/apiv3/page/create-page-helpers';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:ai-tools:create-page');

const determinePath = async (
  user: IUserHasId,
  path?: string,
  todaysMemoTitle?: string,
  pathHintKeywords?: string[],
): Promise<string> => {
  if (path != null) {
    const normalizedPath = normalizePath(path);
    if (isCreatablePage(normalizedPath)) {
      return normalizedPath;
    }

    throw new Error('The specified path is not creatable page path');
  }

  if (todaysMemoTitle != null) {
    const { t } = await getTranslation({ lang: user.lang, ns: 'commons' });
    const path = `${userHomepagePath(user)}/${t('create_page_dropdown.todays.memo')}/${format(new Date(), 'yyyy/MM/dd')}/${todaysMemoTitle}`;
    const normalizedPath = normalizePath(path);
    if (isCreatablePage(normalizedPath)) {
      return normalizedPath;
    }

    throw new Error('The specified path is not creatable page path');
  }

  if (pathHintKeywords != null && pathHintKeywords.length > 0) {
    // TODO: https://redmine.weseek.co.jp/issues/173810
    throw new Error(
      'Path determination based on keywords is not yet implemented',
    );
  }

  throw new Error('Cannot determine page path');
};

type ReqBody = IApiv3PageCreateParams & {
  todaysMemoTitle?: string;
  pathHintKeywords?: string[];
};

type CreatePageReq = Request<undefined, ApiV3Response, ReqBody> & {
  user: IUserHasId;
};

type CreatePageFactory = (crowi: Crowi) => RequestHandler[];

export const createPageHandlersFactory: CreatePageFactory = (crowi) => {
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
          new Error(
            'Either "path", "todaysMemoTitle" or "pathHintKeywords" is required',
          ),
        );
      }

      try {
        const determinedPath = await determinePath(
          req.user,
          path,
          todaysMemoTitle,
          pathHintKeywords,
        );

        const { body: determinedBody, tags: determinedTags } =
          await determineBodyAndTags(determinedPath, body, pageTags);

        const options: IOptionsForCreate = {
          onlyInheritUserRelatedGrantedGroups,
          overwriteScopesOfDescendants,
          wip,
        };

        if (grant != null) {
          options.grant = grant;
          options.grantUserGroupIds = grantUserGroupIds;
        }

        const createdPage = await crowi.pageService.create(
          determinedPath,
          determinedBody,
          req.user,
          options,
        );

        await saveTags({ createdPage, pageTags: determinedTags }, crowi);

        // TODO: https://redmine.weseek.co.jp/issues/173816
        res.apiv3({}, 201);

        postAction(req, res, createdPage, crowi);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
