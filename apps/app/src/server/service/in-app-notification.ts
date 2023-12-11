import type {
  HasObjectId, IUser, IPage,
} from '@growi/core';
import { SubscriptionStatusType } from '@growi/core';
import { subDays } from 'date-fns';
import { Types, FilterQuery, UpdateQuery } from 'mongoose';

import { AllEssentialActions } from '~/interfaces/activity';
import { InAppNotificationStatuses, PaginateResult } from '~/interfaces/in-app-notification';
import { ActivityDocument } from '~/server/models/activity';
import {
  InAppNotification,
  InAppNotificationDocument,
} from '~/server/models/in-app-notification';
import InAppNotificationSettings from '~/server/models/in-app-notification-settings';
import Subscription from '~/server/models/subscription';
import loggerFactory from '~/utils/logger';

import Crowi from '../crowi';
import { RoomPrefix, getRoomNameWithId } from '../util/socket-io-helpers';

import { generateSnapshot } from './in-app-notification/in-app-notification-utils';
import { preNotifyService, type PreNotify } from './pre-notify';


const { STATUS_UNREAD, STATUS_UNOPENED, STATUS_OPENED } = InAppNotificationStatuses;

const logger = loggerFactory('growi:service:inAppNotification');

export default class InAppNotificationService {

  crowi!: Crowi;

  socketIoService!: any;

  activityEvent!: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');
    this.socketIoService = crowi.socketIoService;

    this.emitSocketIo = this.emitSocketIo.bind(this);
    this.upsertByActivity = this.upsertByActivity.bind(this);
    this.getUnreadCountByUser = this.getUnreadCountByUser.bind(this);
    this.createInAppNotification = this.createInAppNotification.bind(this);

    this.initActivityEventListeners();
  }

  initActivityEventListeners(): void {
    this.activityEvent.on('updated', async(activity: ActivityDocument, target: IUser | IPage, preNotify: PreNotify) => {
      try {
        const shouldNotification = activity != null && target != null && (AllEssentialActions as ReadonlyArray<string>).includes(activity.action);
        if (shouldNotification) {
          await this.createInAppNotification(activity, target, preNotify);
        }
      }
      catch (err) {
        logger.error('Create InAppNotification failed', err);
      }
    });
  }

  emitSocketIo = async(targetUsers) => {
    if (this.socketIoService.isInitialized) {
      targetUsers.forEach(async(userId) => {

        // emit to the room for each user
        await this.socketIoService.getDefaultSocket()
          .in(getRoomNameWithId(RoomPrefix.USER, userId))
          .emit('notificationUpdated');
      });
    }
  };

  upsertByActivity = async function(
      users: Types.ObjectId[], activity: ActivityDocument, snapshot: string, createdAt?: Date | null,
  ): Promise<void> {
    const {
      _id: activityId, targetModel, target, action,
    } = activity;
    const now = createdAt || Date.now();
    const lastWeek = subDays(now, 7);
    const operations = users.map((user) => {
      const filter: FilterQuery<InAppNotificationDocument> = {
        user, target, action, createdAt: { $gt: lastWeek }, snapshot,
      };
      const parameters: UpdateQuery<InAppNotificationDocument> = {
        user,
        targetModel,
        target,
        action,
        status: STATUS_UNREAD,
        createdAt: now,
        snapshot,
        $addToSet: { activities: activityId },
      };
      return {
        updateOne: {
          filter,
          update: parameters,
          upsert: true,
        },
      };
    });

    await InAppNotification.bulkWrite(operations);
    logger.info('InAppNotification bulkWrite has run');
    return;
  };

  getLatestNotificationsByUser = async(
      userId: Types.ObjectId,
      queryOptions: {offset: number, limit: number, status?: InAppNotificationStatuses},
  ): Promise<PaginateResult<InAppNotificationDocument>> => {
    const { limit, offset, status } = queryOptions;

    try {
      const pagenateOptions = { user: userId };
      if (status != null) {
        Object.assign(pagenateOptions, { status });
      }
      // TODO: import @types/mongoose-paginate-v2 and use PaginateResult as a type after upgrading mongoose v6.0.0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paginationResult = await (InAppNotification as any).paginate(
        pagenateOptions,
        {
          sort: { createdAt: -1 },
          limit,
          offset,
          populate: [
            { path: 'user' },
            { path: 'target' },
            { path: 'activities', populate: { path: 'user' } },
          ],
        },
      );

      return paginationResult;
    }
    catch (err) {
      logger.error('Error', err);
      throw new Error(err);
    }
  };

  read = async function(user: Types.ObjectId): Promise<void> {
    const query = { user, status: STATUS_UNREAD };
    const parameters = { status: STATUS_UNOPENED };
    await InAppNotification.updateMany(query, parameters);

    return;
  };

  open = async function(user: IUser & HasObjectId, id: Types.ObjectId): Promise<void> {
    const query = { _id: id, user: user._id };
    const parameters = { status: STATUS_OPENED };
    const options = { new: true };

    await InAppNotification.findOneAndUpdate(query, parameters, options);
    return;
  };

  updateAllNotificationsAsOpened = async function(user: IUser & HasObjectId): Promise<void> {
    const filter = { user: user._id, status: STATUS_UNOPENED };
    const options = { status: STATUS_OPENED };

    await InAppNotification.updateMany(filter, options);
    return;
  };

  getUnreadCountByUser = async function(user: Types.ObjectId): Promise<number| undefined> {
    const query = { user, status: STATUS_UNREAD };

    try {
      const count = await InAppNotification.countDocuments(query);

      return count;
    }
    catch (err) {
      logger.error('Error on getUnreadCountByUser', err);
      throw err;
    }
  };

  createSubscription = async function(userId: Types.ObjectId, pageId: Types.ObjectId, targetRuleName: string): Promise<void> {
    const query = { userId };
    const inAppNotificationSettings = await InAppNotificationSettings.findOne(query);
    if (inAppNotificationSettings != null) {
      const subscribeRule = inAppNotificationSettings.subscribeRules.find(subscribeRule => subscribeRule.name === targetRuleName);
      if (subscribeRule != null && subscribeRule.isEnabled) {
        await Subscription.subscribeByPageId(userId, pageId, SubscriptionStatusType.SUBSCRIBE);
      }
    }

    return;
  };

  createInAppNotification = async function(activity: ActivityDocument, target: IUser | IPage, preNotify: PreNotify): Promise<void> {

    const shouldNotification = activity != null && target != null && (AllEssentialActions as ReadonlyArray<string>).includes(activity.action);

    const targetModel = activity.targetModel;

    const snapshot = generateSnapshot(targetModel, target);

    if (shouldNotification) {
      const props = preNotifyService.generateInitialPreNotifyProps();

      await preNotify(props);

      await this.upsertByActivity(props.notificationTargetUsers, activity, snapshot);
      await this.emitSocketIo(props.notificationTargetUsers);
    }
    else {
      throw Error('no activity to notify');
    }
    return;
  };

}

module.exports = InAppNotificationService;
