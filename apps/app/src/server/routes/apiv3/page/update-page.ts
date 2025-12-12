import type { IPage, IRevisionHasId, IUserHasId } from '@growi/core';
import { allOrigin, getIdForRef, Origin } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import {
  isTopPage,
  isUsersProtectedPages,
} from '@growi/core/dist/utils/page-path-utils';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { isAiEnabled } from '~/features/openai/server/services';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import {
  type IApiv3PageUpdateParams,
  PageUpdateErrorCode,
} from '~/interfaces/apiv3';
import type { IOptionsForUpdate } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument, PageModel } from '~/server/models/page';
import {
  serializePageSecurely,
  serializeRevisionSecurely,
} from '~/server/models/serializers';
import { preNotifyService } from '~/server/service/pre-notify';
import { normalizeLatestRevisionIfBroken } from '~/server/service/revision/normalize-latest-revision-if-broken';
import { getYjsService } from '~/server/service/yjs';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:page:update-page');

type ReqBody = IApiv3PageUpdateParams;

interface UpdatePageRequest extends Request<undefined, ApiV3Response, ReqBody> {
  user: IUserHasId;
}

type UpdatePageHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const updatePageHandlersFactory: UpdatePageHandlersFactory = (crowi) => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const Revision = mongoose.model<IRevisionHasId>('Revision');

  const loginRequiredStrictly = require('../../../middlewares/login-required')(
    crowi,
  );

  // define validators for req.body
  const validator: ValidationChain[] = [
    body('pageId')
      .isMongoId()
      .exists()
      .not()
      .isEmpty({ ignore_whitespace: true })
      .withMessage("'pageId' must be specified"),
    body('revisionId')
      .optional()
      .exists()
      .not()
      .isEmpty({ ignore_whitespace: true })
      .withMessage("'revisionId' must be specified"),
    body('body')
      .exists()
      .isString()
      .withMessage("Empty value is not allowed for 'body'"),
    body('grant')
      .optional()
      .not()
      .isString()
      .isInt({ min: 0, max: 5 })
      .withMessage('grant must be an integer from 1 to 5'),
    body('userRelatedGrantUserGroupIds')
      .optional()
      .isArray()
      .withMessage('userRelatedGrantUserGroupIds must be an array of group id'),
    body('overwriteScopesOfDescendants')
      .optional()
      .isBoolean()
      .withMessage('overwriteScopesOfDescendants must be boolean'),
    body('isSlackEnabled')
      .optional()
      .isBoolean()
      .withMessage('isSlackEnabled must be boolean'),
    body('slackChannels')
      .optional()
      .isString()
      .withMessage('slackChannels must be string'),
    body('origin')
      .optional()
      .isIn(allOrigin)
      .withMessage('origin must be "view" or "editor"'),
    body('wip').optional().isBoolean().withMessage('wip must be boolean'),
  ];

  async function postAction(
    req: UpdatePageRequest,
    res: ApiV3Response,
    updatedPage: HydratedDocument<PageDocument>,
    previousRevision: IRevisionHasId | null,
  ) {
    // Reflect the updates in ydoc
    const origin = req.body.origin;
    if (origin === Origin.View || origin === undefined) {
      const yjsService = getYjsService();
      await yjsService.syncWithTheLatestRevisionForce(req.body.pageId);
    }

    // persist activity
    const creator =
      updatedPage.creator != null
        ? getIdForRef(updatedPage.creator)
        : undefined;
    const parameters = {
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: updatedPage,
      action: SupportedAction.ACTION_PAGE_UPDATE,
    };
    const activityEvent = crowi.event('activity');
    activityEvent.emit(
      'update',
      res.locals.activity._id,
      parameters,
      { path: updatedPage.path, creator },
      preNotifyService.generatePreNotify,
    );

    // global notification
    try {
      await crowi.globalNotificationService.fire(
        GlobalNotificationSettingEvent.PAGE_EDIT,
        updatedPage,
        req.user,
      );
    } catch (err) {
      logger.error('Edit notification failed', err);
    }

    // user notification
    const { isSlackEnabled, slackChannels } = req.body;
    if (isSlackEnabled) {
      try {
        const option =
          previousRevision != null ? { previousRevision } : undefined;
        const results = await crowi.userNotificationService.fire(
          updatedPage,
          req.user,
          slackChannels,
          'update',
          option,
        );
        results.forEach((result) => {
          if (result.status === 'rejected') {
            logger.error('Create user notification failed', result.reason);
          }
        });
      } catch (err) {
        logger.error('Create user notification failed', err);
      }
    }

    // Rebuild vector store file
    if (isAiEnabled()) {
      const { getOpenaiService } = await import(
        '~/features/openai/server/services/openai'
      );
      try {
        const openaiService = getOpenaiService();
        await openaiService?.updateVectorStoreFileOnPageUpdate(updatedPage);
      } catch (err) {
        logger.error('Rebuild vector store failed', err);
      }
    }
  }

  const addActivity = generateAddActivityMiddleware();

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    validator,
    apiV3FormValidator,
    async (req: UpdatePageRequest, res: ApiV3Response) => {
      const { pageId, revisionId, body, origin, grant } = req.body;

      const sanitizeRevisionId =
        revisionId == null ? undefined : generalXssFilter.process(revisionId);

      // check page existence
      const isExist = (await Page.count({ _id: { $eq: pageId } })) > 0;
      if (!isExist) {
        return res.apiv3Err(
          new ErrorV3(
            `Page('${pageId}' is not found or forbidden`,
            'notfound_or_forbidden',
          ),
          400,
        );
      }

      // check revision
      const currentPage = await Page.findByIdAndViewer(pageId, req.user);
      // check page existence (for type safety)
      if (currentPage == null) {
        return res.apiv3Err(
          new ErrorV3(
            `Page('${pageId}' is not found or forbidden`,
            'notfound_or_forbidden',
          ),
          400,
        );
      }

      const isGrantImmutable =
        isTopPage(currentPage.path) || isUsersProtectedPages(currentPage.path);

      if (grant != null && grant !== currentPage.grant && isGrantImmutable) {
        return res.apiv3Err(
          new ErrorV3(
            'The grant settings for the specified page cannot be modified.',
            PageUpdateErrorCode.FORBIDDEN,
          ),
          403,
        );
      }

      if (currentPage != null) {
        // Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js'
        try {
          await normalizeLatestRevisionIfBroken(pageId);
        } catch (err) {
          logger.error('Error occurred in normalizing the latest revision');
        }
      }

      if (
        currentPage != null &&
        !(await currentPage.isUpdatable(sanitizeRevisionId, origin))
      ) {
        const latestRevision = await Revision.findById(
          currentPage.revision,
        ).populate('author');
        const returnLatestRevision = {
          revisionId: latestRevision?._id.toString(),
          revisionBody: latestRevision?.body,
          createdAt: latestRevision?.createdAt,
          user: serializeUserSecurely(latestRevision?.author),
        };
        return res.apiv3Err(
          new ErrorV3(
            'Posted param "revisionId" is outdated.',
            PageUpdateErrorCode.CONFLICT,
            undefined,
            { returnLatestRevision },
          ),
          409,
        );
      }

      let updatedPage: HydratedDocument<PageDocument>;
      let previousRevision: IRevisionHasId | null;
      try {
        const {
          userRelatedGrantUserGroupIds,
          overwriteScopesOfDescendants,
          wip,
        } = req.body;
        const options: IOptionsForUpdate = {
          overwriteScopesOfDescendants,
          origin,
          wip,
        };
        if (grant != null) {
          options.grant = grant;
          options.userRelatedGrantUserGroupIds = userRelatedGrantUserGroupIds;
        }
        previousRevision = await Revision.findById(sanitizeRevisionId);

        // There are cases where "revisionId" is not required for revision updates
        // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
        updatedPage = await crowi.pageService.updatePage(
          currentPage,
          body,
          previousRevision?.body ?? null,
          req.user,
          options,
        );
      } catch (err) {
        logger.error('Error occurred while updating a page.', err);
        return res.apiv3Err(err);
      }

      const result = {
        page: serializePageSecurely(updatedPage),
        revision: serializeRevisionSecurely(updatedPage.revision),
      };

      res.apiv3(result, 201);

      postAction(req, res, updatedPage, previousRevision);
    },
  ];
};
