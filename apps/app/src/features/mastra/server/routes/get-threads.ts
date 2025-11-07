import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:mastra:get-threads');

type GetThreadsFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = {
  // no params
};

type Req = Request<ReqParams, Response, undefined> & {
  user: IUserHasId;
};

export const getThreadsFactory: GetThreadsFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    // no params
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      try {
        return res.apiv3({});
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get threads'));
      }
    },
  ];
};
