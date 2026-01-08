import { getIdForRef, type IPage, type IUser, type Ref } from '@growi/core';
import mongoose from 'mongoose';

import type { ActivityDocument } from '../models/activity';
import Subscription from '../models/subscription';

export type PreNotifyProps = {
  notificationTargetUsers?: Ref<IUser>[];
};

export type PreNotify = (props: PreNotifyProps) => Promise<void>;
export type GetAdditionalTargetUsers = (
  activity: ActivityDocument,
) => Promise<Ref<IUser>[]>;
export type GeneratePreNotify = (
  activity: ActivityDocument,
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
    activity: ActivityDocument,
    getAdditionalTargetUsers?: GetAdditionalTargetUsers,
  ): PreNotify => {
    const preNotify = async (props: PreNotifyProps) => {
      const { notificationTargetUsers } = props;

      const User = mongoose.model<IUser, { find; STATUS_ACTIVE }>('User');
      const actionUser = activity.user;
      const target = activity.target;
      const subscribedUsers = await Subscription.getSubscription(
        target as unknown as Ref<IPage>,
      );
      const notificationUsers = subscribedUsers.filter(
        (item) => item.toString() !== getIdForRef(actionUser).toString(),
      );
      const activeNotificationUsers = await User.find({
        _id: { $in: notificationUsers },
        status: User.STATUS_ACTIVE,
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
