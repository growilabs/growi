import type { HasObjectId, IPage, IPageHasId, IUser } from '@growi/core';
import { SubscriptionStatusType } from '@growi/core';
import { subDays } from 'date-fns/subDays';
import mongoose, { type Types } from 'mongoose';

import type {
  auditlogbulkexportjobs,
  pagebulkexportjobs,
} from '~/generated/prisma/client';
import {
  AllEssentialActions,
  SupportedAction,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type { PaginateResult } from '~/interfaces/in-app-notification';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type { ActivityDocument } from '~/server/models/activity';
import type {
  HydratedNotification,
  PageLoader,
} from '~/server/models/in-app-notification';
import InAppNotificationSettings from '~/server/models/in-app-notification-settings';
import Subscription from '~/server/models/subscription';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type Crowi from '../crowi';
import { generateSnapshot } from './in-app-notification/in-app-notification-utils';
import { type PreNotify, preNotifyService } from './pre-notify';
import { getRoomNameWithId, RoomPrefix } from './socket-io/helper';

const { STATUS_UNOPENED, STATUS_OPENED } = InAppNotificationStatuses;

// TODO: once the Page model is migrated to prisma, read through prisma.pages
// inside paginateAndIncludeTarget and stop passing `loadPages` from here.
const loadPages: PageLoader = (pageIds) =>
  mongoose
    .model('Page')
    .find({ _id: { $in: pageIds } })
    .lean<Array<{ _id: { toString(): string } }>>()
    .exec();

const logger = loggerFactory('growi:service:inAppNotification');

export class InAppNotificationService {
  crowi!: Crowi;

  socketIoService!: any;

  activityEvent!: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityEvent = crowi.events.activity;
    this.socketIoService = crowi.socketIoService;

    this.emitSocketIo = this.emitSocketIo.bind(this);
    this.upsertByActivity = this.upsertByActivity.bind(this);
    this.getUnreadCountByUser = this.getUnreadCountByUser.bind(this);
    this.createInAppNotification = this.createInAppNotification.bind(this);

    this.initActivityEventListeners();
  }

  initActivityEventListeners(): void {
    this.activityEvent.on(
      'updated',
      async (
        activity: ActivityDocument,
        target: IUser | IPage | pagebulkexportjobs | auditlogbulkexportjobs,
        preNotify: PreNotify,
      ) => {
        try {
          const shouldNotification =
            activity != null &&
            target != null &&
            (AllEssentialActions as ReadonlyArray<string>).includes(
              activity.action,
            );
          if (shouldNotification) {
            await this.createInAppNotification(activity, target, preNotify);
          }
        } catch (err) {
          logger.error('Create InAppNotification failed', err);
        }
      },
    );
  }

  emitSocketIo = async (targetUsers) => {
    if (this.socketIoService.isInitialized) {
      targetUsers.forEach(async (userId) => {
        // emit to the room for each user
        await this.socketIoService
          .getDefaultSocket()
          .in(getRoomNameWithId(RoomPrefix.USER, userId))
          .emit('notificationUpdated');
      });
    }
  };

  upsertByActivity = async (
    users: Types.ObjectId[],
    activity: ActivityDocument,
    snapshot?: string,
    createdAt?: Date | null,
  ): Promise<void> => {
    const { _id: activityId, targetModel, target, action } = activity;
    const now = createdAt || new Date();

    await prisma.inappnotifications.upsertByActivity({
      userIds: users.map(String),
      activityId: String(activityId),
      targetModel,
      target: target != null ? String(target) : null,
      action,
      snapshot: snapshot ?? null,
      createdAt: now,
      lastWeek: subDays(now, 7),
    });
    logger.info('InAppNotification upsert has run');
    return;
  };

  getLatestNotificationsByUser = async (
    userId: Types.ObjectId,
    queryOptions: {
      offset: number;
      limit: number;
      status?: InAppNotificationStatuses;
    },
  ): Promise<PaginateResult<HydratedNotification>> => {
    const { limit, offset, status } = queryOptions;

    try {
      return await prisma.inappnotifications.paginateAndIncludeTarget(
        {
          where: { userId: String(userId), ...(status != null && { status }) },
          orderBy: { createdAt: 'desc' },
          include: { user: true },
          limit,
          offset,
        },
        loadPages,
      );
    } catch (err) {
      logger.error('Error', err);
      throw new Error(err);
    }
  };

  open = async (
    user: IUser & HasObjectId,
    id: Types.ObjectId,
  ): Promise<void> => {
    await prisma.inappnotifications.updateMany({
      where: { id: String(id), userId: String(user._id) },
      data: { status: STATUS_OPENED },
    });
    return;
  };

  updateAllNotificationsAsOpened = async (
    user: IUser & HasObjectId,
  ): Promise<void> => {
    await prisma.inappnotifications.updateMany({
      where: { userId: String(user._id), status: STATUS_UNOPENED },
      data: { status: STATUS_OPENED },
    });
    return;
  };

  getUnreadCountByUser = async (
    user: Types.ObjectId,
  ): Promise<number | undefined> => {
    try {
      return await prisma.inappnotifications.count({
        where: { userId: String(user), status: STATUS_UNOPENED },
      });
    } catch (err) {
      logger.error('Error on getUnreadCountByUser', err);
      throw err;
    }
  };

  // Mention notifications are generated directly without a dedicated Activity document.
  // Rationale:
  //   - A mention is a sub-event of ACTION_COMMENT_CREATE; creating a separate Activity
  //     would split one comment post into two activities.
  //   - Going through the upsertByActivity flow would apply the 7-day dedup window,
  //     which is not desired for mentions (every mention must notify).
  // Note: notification.action (COMMENT_MENTION) intentionally differs from the
  // referenced activity.action (COMMENT_CREATE). See PR #11022 for discussion
  insertMentionNotifications = async (
    mentionedUserIds: Types.ObjectId[],
    actionUserId: Types.ObjectId,
    activityId: Types.ObjectId,
    page: IPageHasId,
  ): Promise<void> => {
    const filteredUserIds = mentionedUserIds.filter(
      (userId) => userId.toString() !== actionUserId.toString(),
    );

    if (filteredUserIds.length === 0) {
      return;
    }

    const now = new Date();
    const snapshot = await generateSnapshot(
      SupportedTargetModel.MODEL_PAGE,
      page,
    );

    const documents = filteredUserIds.map((userId) => ({
      userId: String(userId),
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: String(page._id),
      action: SupportedAction.ACTION_COMMENT_MENTION,
      status: STATUS_UNOPENED,
      createdAt: now,
      snapshot,
      activities: [String(activityId)],
    }));

    await prisma.inappnotifications.createMany({ data: documents });
    logger.info(
      `insertMentionNotifications: inserted ${filteredUserIds.length} notifications`,
    );
    await this.emitSocketIo(filteredUserIds);
  };

  createSubscription = async (
    userId: Types.ObjectId,
    pageId: Types.ObjectId,
    targetRuleName: string,
  ): Promise<void> => {
    const query = { userId };
    const inAppNotificationSettings =
      await InAppNotificationSettings.findOne(query);
    if (inAppNotificationSettings != null) {
      const subscribeRule = inAppNotificationSettings.subscribeRules.find(
        (subscribeRule) => subscribeRule.name === targetRuleName,
      );
      if (subscribeRule != null && subscribeRule.isEnabled) {
        await Subscription.subscribeByPageId(
          userId,
          pageId,
          SubscriptionStatusType.SUBSCRIBE,
        );
      }
    }

    return;
  };

  createInAppNotification = async function (
    activity: ActivityDocument,
    target: IUser | IPage | pagebulkexportjobs | auditlogbulkexportjobs,
    preNotify: PreNotify,
  ): Promise<void> {
    const shouldNotification =
      activity != null &&
      target != null &&
      (AllEssentialActions as ReadonlyArray<string>).includes(activity.action);

    const targetModel = activity.targetModel;

    const snapshot = await generateSnapshot(targetModel, target);

    if (shouldNotification) {
      const props = preNotifyService.generateInitialPreNotifyProps();

      await preNotify(props);

      await this.upsertByActivity(
        props.notificationTargetUsers,
        activity,
        snapshot,
      );
      await this.emitSocketIo(props.notificationTargetUsers);
    } else {
      throw Error('no activity to notify');
    }
    return;
  };
}
