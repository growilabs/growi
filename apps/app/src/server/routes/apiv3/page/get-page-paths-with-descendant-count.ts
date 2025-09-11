import type { IPage, IUserHasId } from '@growi/core';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';


const logger = loggerFactory('growi:routes:apiv3:page:get-pages-by-page-paths');

type GetPagePathsWithDescendantCountFactory = (crowi: Crowi) => RequestHandler[];

type ReqQuery = {
  paths: string[],
  userGroups?: string[],
  isIncludeEmpty?: boolean,
  includeAnyoneWithTheLink?: boolean,
}

interface Req extends Request<undefined, ApiV3Response, undefined, ReqQuery> {
  user: IUserHasId,
}
export const getPagePathsWithDescendantCountFactory: GetPagePathsWithDescendantCountFactory = (crowi) => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);

  const validator: ValidationChain[] = [
    query('paths').isArray().withMessage('paths must be an array of strings'),
    query('paths').custom((paths: string[]) => {
      if (paths.length > 300) {
        throw new Error('paths must be an array of strings with a maximum length of 300');
      }
      return true;
    }),
    query('paths.*') // each item of paths
      .isString()
      .withMessage('paths must be an array of strings'),

    query('userGroups').optional().isArray().withMessage('userGroups must be an array of strings'),
    query('userGroups.*') // each item of userGroups
      .isMongoId()
      .withMessage('userGroups must be an array of strings'),

    query('isIncludeEmpty').optional().isBoolean().withMessage('isIncludeEmpty must be a boolean'),
    query('isIncludeEmpty').toBoolean(),

    query('includeAnyoneWithTheLink').optional().isBoolean().withMessage('includeAnyoneWithTheLink must be a boolean'),
    query('includeAnyoneWithTheLink').toBoolean(),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly,
    validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const {
        paths, userGroups, isIncludeEmpty, includeAnyoneWithTheLink,
      } = req.query;

      try {
        const pagePathsWithDescendantCount = await Page.descendantCountByPaths(paths, req.user, userGroups, isIncludeEmpty, includeAnyoneWithTheLink);
        return res.apiv3({ pagePathsWithDescendantCount });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
