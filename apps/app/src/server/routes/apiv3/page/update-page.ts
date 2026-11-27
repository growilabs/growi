import type { IPage, IUserHasId } from '@growi/core';
import { allOrigin } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import {
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { revisions } from '~/generated/prisma/client';
import {
  type IApiv3PageUpdateParams,
  PageUpdateErrorCode,
} from '~/interfaces/apiv3';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageDocument, PageModel } from '~/server/models/page';
import {
  serializePageSecurely,
  serializeRevisionSecurely,
} from '~/server/models/serializers';
import { configManager } from '~/server/service/config-manager/config-manager';
import { isGrantImmutablePath } from '~/server/service/page/grant-immutable-path';
import {
  emitPageUpdateActivity,
  runAfterHumanUpdate,
  type UpdatePageBodyHumanOptions,
  updatePageBody,
} from '~/server/service/page-save';
import { normalizeLatestRevisionIfBroken } from '~/server/service/revision/normalize-latest-revision-if-broken';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:page:update-page');

type ReqBody = IApiv3PageUpdateParams;

interface UpdatePageRequest
  extends Request<Record<string, string>, ApiV3Response, ReqBody> {
  user: IUserHasId;
}

export const updatePageHandlersFactory = (crowi: Crowi): RequestHandler[] => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  const loginRequiredStrictly = loginRequiredFactory(crowi);

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

  async function respondConflict(
    res: ApiV3Response,
    latestRevisionId: string | undefined,
  ) {
    const latestRevision =
      latestRevisionId != null
        ? await prisma.revisions.findUnique({
            where: { id: latestRevisionId },
            include: { author: true },
          })
        : undefined;
    const returnLatestRevision = {
      revisionId: latestRevision?._id,
      revisionBody: latestRevision?.body,
      createdAt: latestRevision?.createdAt,
      user: serializeUserSecurely(
        latestRevision?.author as IUserHasId | undefined,
      ),
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

  const addActivity = generateAddActivityMiddleware();

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    ...validator,
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

      const disableUserPages = configManager.getConfig(
        'security:disableUserPages',
      );
      if (
        disableUserPages &&
        (isUsersTopPage(currentPage.path) || isUserPage(currentPage.path))
      ) {
        return res.apiv3Err('User pages are disabled');
      }

      if (
        grant != null &&
        grant !== currentPage.grant &&
        isGrantImmutablePath(currentPage.path)
      ) {
        return res.apiv3Err(
          new ErrorV3(
            'The grant settings for the specified page cannot be modified.',
            PageUpdateErrorCode.FORBIDDEN,
          ),
          403,
        );
      }

      if (currentPage != null) {
        // Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js' provided by v6.1.0 - v7.0.15
        try {
          await normalizeLatestRevisionIfBroken(pageId);
        } catch (err) {
          logger.error('Error occurred in normalizing the latest revision');
        }
      }

      let updatedPage: HydratedDocument<PageDocument>;
      let previousRevision: revisions | null;
      try {
        const {
          userRelatedGrantUserGroupIds,
          overwriteScopesOfDescendants,
          wip,
        } = req.body;
        const options: UpdatePageBodyHumanOptions = {
          overwriteScopesOfDescendants,
          wip,
          ...(grant != null ? { grant, userRelatedGrantUserGroupIds } : {}),
        };

        // There are cases where "revisionId" is not required for revision updates
        // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
        const saveResult = await updatePageBody(
          { pageService: crowi.pageService },
          {
            mode: 'human',
            page: currentPage,
            body,
            user: req.user,
            clientRevisionId: sanitizeRevisionId,
            origin,
            options,
          },
        );

        if (saveResult.type === 'conflict') {
          return await respondConflict(res, saveResult.latestRevisionId);
        }
        updatedPage = saveResult.page;
        previousRevision = saveResult.previousRevision;
      } catch (err) {
        logger.error({ err }, 'Error occurred while updating a page.');
        return res.apiv3Err(err);
      }

      const result = {
        page: serializePageSecurely(updatedPage),
        revision: serializeRevisionSecurely(updatedPage.revision),
      };

      // emit before res.apiv3() — see rules/activity-recording.md
      const activityId = res.locals.activity?._id;
      if (activityId != null) {
        await emitPageUpdateActivity(crowi, {
          activityId,
          page: updatedPage,
          user: req.user,
        });
      }

      res.apiv3(result, 201);

      runAfterHumanUpdate(crowi, {
        pageId,
        page: updatedPage,
        user: req.user,
        origin,
        previousRevision,
        isSlackEnabled: req.body.isSlackEnabled,
        slackChannels: req.body.slackChannels,
      });
    },
  ];
};
