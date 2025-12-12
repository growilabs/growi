import type { IPage, IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body, param } from 'express-validator';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import type { PageModel } from '~/server/models/page';
import { getYjsService } from '~/server/service/yjs';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory(
  'growi:routes:apiv3:page:sync-latest-revision-body-to-yjs-draft',
);

type SyncLatestRevisionBodyToYjsDraftHandlerFactory = (
  crowi: Crowi,
) => RequestHandler[];

type ReqParams = {
  pageId: string;
};
type ReqBody = {
  editingMarkdownLength?: number;
};
interface Req extends Request<ReqParams, ApiV3Response, ReqBody> {
  user: IUserHasId;
}
export const syncLatestRevisionBodyToYjsDraftHandlerFactory: SyncLatestRevisionBodyToYjsDraftHandlerFactory =
  (crowi) => {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const loginRequiredStrictly =
      require('../../../middlewares/login-required')(crowi);

    // define validators for req.params
    const validator: ValidationChain[] = [
      param('pageId')
        .isMongoId()
        .withMessage('The param "pageId" must be specified'),
      body('editingMarkdownLength')
        .optional()
        .isInt()
        .withMessage('The body "editingMarkdownLength" must be integer'),
    ];

    return [
      accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
      loginRequiredStrictly,
      validator,
      apiV3FormValidator,
      async (req: Req, res: ApiV3Response) => {
        const { pageId } = req.params;
        const { editingMarkdownLength } = req.body;

        // check whether accessible
        if (!(await Page.isAccessiblePageByViewer(pageId, req.user))) {
          return res.apiv3Err(
            new ErrorV3(
              'Current user is not accessible to this page.',
              'forbidden-page',
            ),
            403,
          );
        }

        try {
          const yjsService = getYjsService();
          const result = await yjsService.syncWithTheLatestRevisionForce(
            pageId,
            editingMarkdownLength,
          );
          return res.apiv3(result);
        } catch (err) {
          logger.error(err);
          return res.apiv3Err(err);
        }
      },
    ];
  };
