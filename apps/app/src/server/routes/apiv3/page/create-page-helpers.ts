import type { IUserHasId } from '@growi/core/dist/interfaces';
import { attachTitleHeader } from '@growi/core/dist/utils/path-utils';
import type { Request } from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { isAiEnabled } from '~/features/openai/server/services';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IApiv3PageCreateParams } from '~/interfaces/apiv3';
import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageTagRelation from '~/server/models/page-tag-relation';
import type { PageTagRelationDocument } from '~/server/models/page-tag-relation';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';


const logger = loggerFactory('growi:routes:apiv3:page:create-page-helpers');


type ReqBody = IApiv3PageCreateParams;

interface CreatePageRequest extends Request<undefined, ApiV3Response, ReqBody> {
  user: IUserHasId,
}


/**
 * Determine the body and tags for a new page
 * @param path - The path of the page to create
 * @param _body - The body content provided by the user (optional)
 * @param _tags - The tags provided by the user (optional)
 * @returns An object containing the determined body and tags
 */
export async function determineBodyAndTags(
    path: string,
    _body: string | null | undefined,
    _tags: string[] | null | undefined,
): Promise<{ body: string, tags: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Page = mongoose.model<any, PageModel>('Page');

  let body: string = _body ?? '';
  let tags: string[] = _tags ?? [];

  if (_body == null) {
    const isEnabledAttachTitleHeader = configManager.getConfig('customize:isEnabledAttachTitleHeader');
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


/**
 * Save tags for a created page
 * @param params - Object containing the created page and tags
 * @param crowi - Crowi instance
 * @returns Array of saved tag names
 */
export async function saveTags(
    { createdPage, pageTags }: { createdPage: PageDocument, pageTags: string[] },
    crowi: Crowi,
): Promise<PageTagRelationDocument[]> {
  const tagEvent = crowi.event('tag');
  await PageTagRelation.updatePageTags(createdPage.id, pageTags);
  tagEvent.emit('update', createdPage, pageTags);
  return PageTagRelation.listTagNamesByPage(createdPage.id);
}


/**
 * Perform post-creation actions including activity logging, notifications, and subscriptions
 * @param req - The request object
 * @param res - The response object
 * @param createdPage - The created page document
 * @param crowi - Crowi instance
 */
export async function postAction(
    req: CreatePageRequest,
    res: ApiV3Response,
    createdPage: HydratedDocument<PageDocument>,
    crowi: Crowi,
): Promise<void> {
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
      results.forEach((result: PromiseSettledResult<unknown>) => {
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
