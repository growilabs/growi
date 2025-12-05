import type { IPage, IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { param } from 'express-validator';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:page:unpublish-page');

type ReqParams = {
  pageId: string;
};

interface Req extends Request<ReqParams, ApiV3Response> {
  user: IUserHasId;
}

type UnpublishPageHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const unpublishPageHandlersFactory: UnpublishPageHandlersFactory = (
  crowi,
) => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  const loginRequiredStrictly = require('../../../middlewares/login-required')(
    crowi,
  );

  // define validators for req.body
  const validator: ValidationChain[] = [
    param('pageId')
      .isMongoId()
      .withMessage('The param "pageId" must be specified'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { pageId } = req.params;

      try {
        const page = await Page.findById(pageId);
        if (page == null) {
          return res.apiv3Err(new ErrorV3(`Page ${pageId} is not exist.`), 404);
        }

        page.unpublish();
        const updatedPage = await page.save();

        return res.apiv3(updatedPage);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
