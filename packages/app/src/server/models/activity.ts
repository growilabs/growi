import { getOrCreateModel, getModelSafely } from '@growi/core';
import {
  Types, Document, Model, Schema,
} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import {
  AllSupportedTargetModelType, AllSupportedActionType, SupportedActionType, ISnapshot,
} from '~/interfaces/activity';

import loggerFactory from '../../utils/logger';
import activityEvent from '../events/activity';

import Subscription from './subscription';

const logger = loggerFactory('growi:models:activity');

export interface ActivityDocument extends Document {
  _id: Types.ObjectId
  user: Types.ObjectId | any
  ip: string
  endpoint: string
  targetModel: string
  target: Types.ObjectId
  action: SupportedActionType
  snapshot: ISnapshot

  getNotificationTargetUsers(): Promise<any[]>
}

export interface ActivityModel extends Model<ActivityDocument> {
  [x:string]: any
  getActionUsersFromActivities(activities: ActivityDocument[]): any[]
}

const snapshotSchema = new Schema<ISnapshot>({
  username: { type: String, index: true },
});

// TODO: add revision id
const activitySchema = new Schema<ActivityDocument, ActivityModel>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  ip: {
    type: String,
  },
  endpoint: {
    type: String,
  },
  targetModel: {
    type: String,
    enum: AllSupportedTargetModelType,
  },
  target: {
    type: Schema.Types.ObjectId,
    refPath: 'targetModel',
  },
  action: {
    type: String,
    enum: AllSupportedActionType,
    required: true,
  },
  snapshot: snapshotSchema,
}, {
  timestamps: {
    createdAt: true,
    updatedAt: false,
  },
});
activitySchema.index({ target: 1, action: 1 });
activitySchema.index({
  user: 1, target: 1, action: 1, createdAt: 1,
}, { unique: true });
activitySchema.plugin(mongoosePaginate);

activitySchema.post('save', function() {
  logger.debug('activity has been created', this);
});


activitySchema.methods.getNotificationTargetUsers = async function() {
  const User = getModelSafely('User') || require('~/server/models/user')();
  const { user: actionUser, target } = this;

  const [subscribeUsers, unsubscribeUsers] = await Promise.all([
    Subscription.getSubscription((target as any) as Types.ObjectId),
    Subscription.getUnsubscription((target as any) as Types.ObjectId),
  ]);

  const unique = array => Object.values(array.reduce((objects, object) => ({ ...objects, [object.toString()]: object }), {}));
  const filter = (array, pull) => {
    const ids = pull.map(object => object.toString());
    return array.filter(object => !ids.includes(object.toString()));
  };
  const notificationUsers = filter(unique([...subscribeUsers]), [...unsubscribeUsers, actionUser]);
  const activeNotificationUsers = await User.find({
    _id: { $in: notificationUsers },
    status: User.STATUS_ACTIVE,
  }).distinct('_id');
  return activeNotificationUsers;
};

activitySchema.post('save', async(savedActivity: ActivityDocument) => {
  let targetUsers: Types.ObjectId[] = [];
  try {
    targetUsers = await savedActivity.getNotificationTargetUsers();
  }
  catch (err) {
    logger.error(err);
  }

  activityEvent.emit('create', targetUsers, savedActivity);
});

activitySchema.statics.getPaginatedActivity = async function(limit: number, offset: number, query) {
  const paginateResult = await this.paginate(
    query,
    {
      limit,
      offset,
      sort: { createdAt: -1 },
    },
  );
  return paginateResult;
};

activitySchema.statics.findSnapshotUsernamesByUsernameRegexWithTotalCount = async function(
    q: string, option: { sortOpt: number | string, offset: number, limit: number},
): Promise<{usernames: string[], totalCount: number}> {
  const opt = option || {};
  const sortOpt = opt.sortOpt || 1;
  const offset = opt.offset || 0;
  const limit = opt.limit || 10;

  const conditions = { 'snapshot.username': { $regex: q, $options: 'i' } };

  const usernames = await this.aggregate()
    .skip(0)
    .limit(10000) // Narrow down the search target
    .match(conditions)
    .group({ _id: '$snapshot.username' })
    .sort({ _id: sortOpt }) // Sort "snapshot.username" in ascending order
    .skip(offset)
    .limit(limit);

  const totalCount = (await this.find(conditions).distinct('snapshot.username')).length;

  return { usernames: usernames.map(r => r._id), totalCount };
};

export default getOrCreateModel<ActivityDocument, ActivityModel>('Activity', activitySchema);
