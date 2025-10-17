import { allOrigin } from '@growi/core';
import type {
  IPage, IUser, IUserHasId,
} from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { isCreatablePage, isUserPage, isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';
import { attachTitleHeader, normalizePath } from '@growi/core/dist/utils/path-utils';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { body } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { isAiEnabled } from '~/features/openai/server/services';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IApiv3PageCreateParams } from '~/interfaces/apiv3';
import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import type { IOptionsForCreate } from '~/interfaces/page';
import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageTagRelation from '~/server/models/page-tag-relation';
import { serializePageSecurely, serializeRevisionSecurely } from '~/server/models/serializers';
import { configManager } from '~/server/service/config-manager';
import { getTranslation } from '~/server/service/i18next';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import type { ApiV3Response } from '../interfaces/apiv3-response';


const logger = loggerFactory('growi:routes:apiv3:page:create-page');


async function generateUntitledPath(parentPath: string, basePathname: string, index = 1): Promise<string> {
  const Page = mongoose.model<IPage>('Page');

  const path = normalizePath(`${normalizePath(parentPath)}/${basePathname}-${index}`);
  if (await Page.exists({ path, isEmpty: false }) != null) {
    return generateUntitledPath(parentPath, basePathname, index + 1);
  }
  return path;
}

async function determinePath(_parentPath?: string, _path?: string, optionalParentPath?: string): Promise<string> {
  const { t } = await getTranslation();

  const basePathname = t?.('create_page.untitled') || 'Untitled';

  if (_path != null) {
    const path = normalizePath(_path);

    // when path is valid
    if (isCreatablePage(path)) {
      return normalizePath(path);
    }
    // when optionalParentPath is set
    if (optionalParentPath != null) {
      return generateUntitledPath(optionalParentPath, basePathname);
    }
    // when path is invalid
    throw new Error('Could not create the page for the path');
  }

  if (_parentPath != null) {
    const parentPath = normalizePath(_parentPath);

    // when parentPath is user's homepage
    if (isUsersHomepage(parentPath)) {
      return generateUntitledPath(parentPath, basePathname);
    }

    // when parentPath is valid
    if (isCreatablePage(parentPath)) {
      return generateUntitledPath(parentPath, basePathname);
    }
    // when optionalParentPath is set
    if (optionalParentPath != null) {
      return generateUntitledPath(optionalParentPath, basePathname);
    }
    // when parentPath is invalid
    throw new Error('Could not create the page for the parentPath');
  }

  // when both path and parentPath are not specified
  return generateUntitledPath('/', basePathname);
}


type ReqBody = IApiv3PageCreateParams

interface CreatePageRequest extends Request<undefined, ApiV3Response, ReqBody> {
  user: IUserHasId,
}

type CreatePageHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const createPageHandlersFactory: CreatePageHandlersFactory = (crowi) => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const User = mongoose.model<IUser, { isExistUserByUserPagePath: any }>('User');

  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);


  // define validators for req.body
  const validator: ValidationChain[] = [
    body('path').optional().not().isEmpty({ ignore_whitespace: true })
      .withMessage("Empty value is not allowed for 'path'"),
    body('parentPath').optional().not().isEmpty({ ignore_whitespace: true })
      .withMessage("Empty value is not allowed for 'parentPath'"),
    body('optionalParentPath').optional().not().isEmpty({ ignore_whitespace: true })
      .withMessage("Empty value is not allowed for 'optionalParentPath'"),
    body('body').optional().isString()
      .withMessage('body must be string or undefined'),
    body('grant').optional().isInt({ min: 0, max: 5 }).withMessage('grant must be integer from 1 to 5'),
    body('onlyInheritUserRelatedGrantedGroups').optional().isBoolean().withMessage('onlyInheritUserRelatedGrantedGroups must be boolean'),
    body('overwriteScopesOfDescendants').optional().isBoolean().withMessage('overwriteScopesOfDescendants must be boolean'),
    body('pageTags').optional().isArray().withMessage('pageTags must be array'),
    body('isSlackEnabled').optional().isBoolean().withMessage('isSlackEnabled must be boolean'),
    body('slackChannels').optional().isString().withMessage('slackChannels must be string'),
    body('wip').optional().isBoolean().withMessage('wip must be boolean'),
    body('origin').optional().isIn(allOrigin).withMessage('origin must be "view" or "editor"'),
  ];


  async function determineBodyAndTags(
      path: string,
      _body: string | null | undefined, _tags: string[] | null | undefined,
  ): Promise<{ body: string, tags: string[] }> {

    let body: string = _body ?? '';
    let tags: string[] = _tags ?? [];

    if (_body == null) {
      const isEnabledAttachTitleHeader = await configManager.getConfig('customize:isEnabledAttachTitleHeader');
      if (isEnabledAttachTitleHeader) {
        body += `${attachTitleHeader(path)}\n`;
      }

      const templateData = await Page.findTemplate(path);
      if (templateData.templateTags != null) {
        tags = templateData.templateTags;
      }
      if (templateData.templateBody != null) {
        body += `${templateData.templateBody}\n`;
      }
    }

    return { body, tags };
  }

  async function saveTags({ createdPage, pageTags }: { createdPage: PageDocument, pageTags: string[] }) {
    const tagEvent = crowi.event('tag');
    await PageTagRelation.updatePageTags(createdPage.id, pageTags);
    tagEvent.emit('update', createdPage, pageTags);
    return PageTagRelation.listTagNamesByPage(createdPage.id);
  }

  async function postAction(req: CreatePageRequest, res: ApiV3Response, createdPage: HydratedDocument<PageDocument>) {
    // persist activity
    const parameters = {
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: createdPage,
      action: SupportedAction.ACTION_PAGE_CREATE,
    };
    const activityEvent = crowi.event('activity');
    activityEvent.emit('update', res.locals.activity._id, parameters);

    // global notification
    try {
      await crowi.globalNotificationService.fire(GlobalNotificationSettingEvent.PAGE_CREATE, createdPage, req.user);
    }
    catch (err) {
      logger.error('Create grobal notification failed', err);
    }

    // user notification
    const { isSlackEnabled, slackChannels } = req.body;
    if (isSlackEnabled) {
      try {
        const results = await crowi.userNotificationService.fire(createdPage, req.user, slackChannels, 'create');
        results.forEach((result) => {
          if (result.status === 'rejected') {
            logger.error('Create user notification failed', result.reason);
          }
        });
      }
      catch (err) {
        logger.error('Create user notification failed', err);
      }
    }

    // create subscription
    try {
      await crowi.inAppNotificationService.createSubscription(req.user._id, createdPage._id, subscribeRuleNames.PAGE_CREATE);
    }
    catch (err) {
      logger.error('Failed to create subscription document', err);
    }

    // Rebuild vector store file
    if (isAiEnabled()) {
      const { getOpenaiService } = await import('~/features/openai/server/services/openai');
      try {
        const openaiService = getOpenaiService();
        await openaiService?.createVectorStoreFileOnPageCreate([createdPage]);
      }
      catch (err) {
        logger.error('Rebuild vector store failed', err);
      }
    }
  }

  const addActivity = generateAddActivityMiddleware();

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly, excludeReadOnlyUser, addActivity,
    validator, apiV3FormValidator,
    async(req: CreatePageRequest, res: ApiV3Response) => {
      const {
        body: bodyByParam, pageTags: tagsByParam,
      } = req.body;

      let pathToCreate: string;
      try {
        const { path, parentPath, optionalParentPath } = req.body;
        pathToCreate = await determinePath(parentPath, path, optionalParentPath);
      }
      catch (err) {
        return res.apiv3Err(new ErrorV3(err.toString(), 'could_not_create_page'));
      }

      if (isUserPage(pathToCreate)) {
        const isExistUser = await User.isExistUserByUserPagePath(pathToCreate);
        if (!isExistUser) {
          return res.apiv3Err("Unable to create a page under a non-existent user's user page");
        }
      }

      const { body, tags } = await determineBodyAndTags(pathToCreate, bodyByParam, tagsByParam);

      let createdPage: HydratedDocument<PageDocument>;
      try {
        const {
          grant, grantUserGroupIds, onlyInheritUserRelatedGrantedGroups, overwriteScopesOfDescendants, wip, origin,
        } = req.body;

        const options: IOptionsForCreate = {
          onlyInheritUserRelatedGrantedGroups, overwriteScopesOfDescendants, wip, origin,
        };
        if (grant != null) {
          options.grant = grant;
          options.grantUserGroupIds = grantUserGroupIds;
        }
        createdPage = await crowi.pageService.create(
          pathToCreate,
          body,
          req.user,
          options,
        );
      }
      catch (err) {
        logger.error('Error occurred while creating a page.', err);
        return res.apiv3Err(err);
      }

      const savedTags = await saveTags({ createdPage, pageTags: tags });

      const result = {
        page: serializePageSecurely(createdPage),
        tags: savedTags,
        revision: serializeRevisionSecurely(createdPage.revision),
      };

      res.apiv3(result, 201);

      postAction(req, res, createdPage);
    },
  ];
};
