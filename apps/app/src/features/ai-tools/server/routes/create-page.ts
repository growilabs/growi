import {
  GroupType,
  type IGrantedGroup,
  type IUserHasId,
  type PageGrant,
  SCOPE,
} from '@growi/core/dist/interfaces';
import {
  isCreatablePage,
  userHomepagePath,
} from '@growi/core/dist/utils/page-path-utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import { format } from 'date-fns/format';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';

import type { IOptionsForCreate } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
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
    const parentDirName = t('create_page_dropdown.todays.memo');
    const now = format(new Date(), 'yyyy/MM/dd');
    const path = `${userHomepagePath(user)}/${parentDirName}/${now}/${todaysMemoTitle}`;
    const normalizedPath = normalizePath(path);
    if (isCreatablePage(normalizedPath)) {
      return normalizedPath;
    }

    throw new Error('The specified path is not creatable page path');
  }

  if (pathHintKeywords != null && pathHintKeywords.length > 0) {
    return '';
  }

  throw new Error('Cannot determine page path');
};

type ReqBody = {
  path?: string;
  pathHintKeywords?: string[];
  todaysMemoTitle?: string;
  body: string;
  grant?: PageGrant;
  grantUserGroupIds?: IGrantedGroup[];
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
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT]), // TODO: https://redmine.weseek.co.jp/issues/172491
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: CreatePageReq, res: ApiV3Response) => {
      const {
        path,
        pathHintKeywords,
        todaysMemoTitle,
        body,
        grant,
        grantUserGroupIds,
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

        const option: IOptionsForCreate = {};
        if (grant != null) {
          option.grant = grant;
          option.grantUserGroupIds = grantUserGroupIds;
        }

        const createdPage = await crowi.pageService.create(
          determinedPath,
          body,
          req.user,
          option,
        );

        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
