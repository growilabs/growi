import type { IPage, IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:page:check-page-existence');

type ReqQuery = {
  path: string;
};

interface Req extends Request<ReqQuery, ApiV3Response> {
  user?: IUserHasId;
}

export const checkPageExistenceHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  const loginRequired = loginRequiredFactory(crowi, true);

  // define validators for req.body
  const validator = [
    query('path').isString().withMessage('The param "path" must be specified'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { path } = req.query;

      if (path == null || Array.isArray(path)) {
        return res.apiv3Err(new ErrorV3('The param "path" must be a string'));
      }

      const normalizedPath = normalizePath(path.toString());
      const count = await Page.countByPathAndViewer(normalizedPath, req.user);
      res.apiv3({ isExist: count > 0 });
    },
  ];
};
