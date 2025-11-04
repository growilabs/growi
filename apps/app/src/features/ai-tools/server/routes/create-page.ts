import { type IUserHasId, SCOPE } from '@growi/core/dist/interfaces';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:ai-tools:create-page');

type ReqBody = {
  path?: string;
  pathHintKeywords?: string[];
  todaysMemoTitle?: string;
  body?: string;
  grant?: number;
  pageTags?: string[];
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
    body('pathHintKeywords')
      .optional()
      .isArray()
      .withMessage('"pathHintKeywords" must be array'),
    body('todaysMemoTitle')
      .optional()
      .isString()
      .withMessage('"todaysMemoTitle" must be string'),
    body('body')
      .optional()
      .isString()
      .withMessage('"body" must be string or undefined'),
    body('grant')
      .optional()
      .isInt({ min: 0, max: 5 })
      .withMessage('"grant" must be integer from 1 to 5'),
    body('pageTags')
      .optional()
      .isArray()
      .withMessage('"pageTags" must be array'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT]), // TODO: https://redmine.weseek.co.jp/issues/172491
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: CreatePageReq, res: ApiV3Response) => {
      const { path, pathHintKeywords, todaysMemoTitle, body, grant, pageTags } =
        req.body;

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
        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
