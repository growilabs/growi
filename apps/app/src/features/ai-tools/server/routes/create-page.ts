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
    body('path').optional().isString().withMessage('path must be string'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT]), // TODO: https://redmine.weseek.co.jp/issues/172491
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: CreatePageReq, res: ApiV3Response) => {
      try {
        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
