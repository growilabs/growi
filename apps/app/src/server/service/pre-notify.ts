import { getIdForRef, type IPage, type IUser, type Ref } from '@growi/core';
import mongoose from 'mongoose';

import type { IActivity } from '~/interfaces/activity';

import Subscription from '../models/subscription';
import { UserStatus } from '../models/user/conts';

export type PreNotifyProps = {
  notificationTargetUsers?: Ref<IUser>[];
};

export type PreNotify = (props: PreNotifyProps) => Promise<void>;
export type GetAdditionalTargetUsers = (
  activity: IActivity,
) => Promise<Ref<IUser>[]>;
export type GeneratePreNotify = (
  activity: IActivity,
  getAdditionalTargetUsers?: GetAdditionalTargetUsers,
) => PreNotify;

interface IPreNotifyService {
  generateInitialPreNotifyProps: (PreNotifyProps) => {
    notificationTargetUsers?: Ref<IUser>[];
  };
  generatePreNotify: GeneratePreNotify;
}

class PreNotifyService implements IPreNotifyService {
  generateInitialPreNotifyProps = (): PreNotifyProps => {
    const initialPreNotifyProps: Ref<IUser>[] = [];

    return { notificationTargetUsers: initialPreNotifyProps };
  };

  generatePreNotify = (
    activity: IActivity,
    getAdditionalTargetUsers?: GetAdditionalTargetUsers,
  ): PreNotify => {
    const preNotify = async (props: PreNotifyProps) => {
      const { notificationTargetUsers } = props;

      const User = mongoose.model<IUser, { find }>('User');
      const actionUser = activity.user;
      const target = activity.target;
      const subscribedUsers = await Subscription.getSubscription(
        target as unknown as Ref<IPage>,
      );
      // actionUser is absent for system-triggered activities with no acting
      // user; in that case there is no one to exclude from the subscribers.
      const notificationUsers =
        actionUser == null
          ? subscribedUsers
          : subscribedUsers.filter(
              (item) => item.toString() !== getIdForRef(actionUser).toString(),
            );
      const activeNotificationUsers = await User.find({
        _id: { $in: notificationUsers },
        status: UserStatus.STATUS_ACTIVE,
      }).distinct('_id');

      if (getAdditionalTargetUsers == null) {
        notificationTargetUsers?.push(...activeNotificationUsers);
      } else {
        const AdditionalTargetUsers = await getAdditionalTargetUsers(activity);

        notificationTargetUsers?.push(
          ...activeNotificationUsers,
          ...AdditionalTargetUsers,
        );
      }
    };

    return preNotify;
  };
}

export const preNotifyService = new PreNotifyService();
