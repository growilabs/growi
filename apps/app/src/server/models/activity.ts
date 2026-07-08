import type { IUser, Ref } from '@growi/core';
import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import type {
  IActivity,
  ISnapshot,
  SupportedActionType,
  SupportedEventModelType,
  SupportedTargetModelType,
} from '~/interfaces/activity';
import {
  AllSupportedActions,
  AllSupportedEventModels,
  AllSupportedTargetModels,
} from '~/interfaces/activity';

import loggerFactory from '../../utils/logger';
import { getOrCreateModel } from '../util/mongoose-utils';
import { buildUsernamePrefixRegexQuery } from '../util/username-prefix-regex';

const logger = loggerFactory('growi:models:activity');

export interface ActivityDocument extends Document {
  _id: Types.ObjectId;
  user: Ref<IUser>;
  ip: string;
  endpoint: string;
  targetModel: SupportedTargetModelType;
  target: Types.ObjectId;
  eventModel: SupportedEventModelType;
  event: Types.ObjectId;
  action: SupportedActionType;
  snapshot: ISnapshot;
  createdAt: Date;
}

export interface ActivityModel extends Model<ActivityDocument> {
  [x: string]: any;
  getActionUsersFromActivities(activities: ActivityDocument[]): any[];
}

const snapshotSchema = new Schema<ISnapshot>({
  username: { type: String, index: true },
});

// TODO: add revision id
const activitySchema = new Schema<ActivityDocument, ActivityModel>(
  {
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
      enum: AllSupportedTargetModels,
    },
    target: {
      type: Schema.Types.ObjectId,
      refPath: 'targetModel',
    },
    eventModel: {
      type: String,
      enum: AllSupportedEventModels,
    },
    event: {
      type: Schema.Types.ObjectId,
    },
    action: {
      type: String,
      enum: AllSupportedActions,
      required: true,
    },
    snapshot: snapshotSchema,
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  },
);
// activitySchema.index({ createdAt: 1 }); // Do not create index here because it is created by ActivityService as TTL index
activitySchema.index({ target: 1, action: 1 });
activitySchema.index(
  {
    user: 1,
    target: 1,
    action: 1,
    createdAt: 1,
  },
  { unique: true },
);
activitySchema.plugin(mongoosePaginate);

activitySchema.post('save', function () {
  logger.debug({ activity: this }, 'activity has been created');
});

activitySchema.statics.createByParameters = async function (
  parameters,
): Promise<IActivity> {
  const activity = (await this.create(parameters)) as unknown as IActivity;

  return activity;
};

// When using this method, ensure that activity updates are allowed using ActivityService.shoudUpdateActivity
activitySchema.statics.updateByParameters = async function (
  activityId: string,
  parameters,
): Promise<ActivityDocument | null> {
  const activity = await this.findOneAndUpdate(
    { _id: activityId },
    parameters,
    { new: true },
  ).exec();

  return activity;
};

// Prefix-only, unlike the ES path (elasticsearch.ts#searchAuditlogByFuzzyWildcard),
// which also matches via `fuzzy: { fuzziness: 'AUTO' }` — this MongoDB fallback
// does not tolerate typos.
// Note: the case-insensitive regex cannot use a bounded prefix seek on the
// snapshot.username index; MongoDB scans the whole index (covered scan).
const buildSnapshotUsernameRegexConditions = (q: string) => ({
  'snapshot.username': buildUsernamePrefixRegexQuery(q),
});

const aggregateSnapshotUsernames = async (
  model: ActivityModel,
  conditions: ReturnType<typeof buildSnapshotUsernameRegexConditions>,
  { offset, limit }: { offset: number; limit: number },
): Promise<string[]> => {
  const usernames = await model
    .aggregate()
    .match(conditions)
    .group({ _id: '$snapshot.username' })
    .sort({ _id: 1 }) // Sort "snapshot.username" in ascending order
    .skip(offset)
    .limit(limit)
    .allowDiskUse(true);

  return usernames.map((r) => r._id);
};

activitySchema.statics.findSnapshotUsernamesByUsernameRegex = function (
  q: string,
  option: { offset: number; limit: number },
): Promise<string[]> {
  const opt = option || {};
  const conditions = buildSnapshotUsernameRegexConditions(q);

  return aggregateSnapshotUsernames(this, conditions, {
    offset: opt.offset || 0,
    limit: opt.limit || 10,
  });
};

activitySchema.statics.findSnapshotUsernamesByUsernameRegexWithTotalCount =
  async function (
    q: string,
    option: { offset: number; limit: number },
  ): Promise<{ usernames: string[]; totalCount: number }> {
    const opt = option || {};
    const conditions = buildSnapshotUsernameRegexConditions(q);

    const [result] = await this.aggregate()
      .match(conditions)
      .group({ _id: '$snapshot.username' })
      .facet({
        usernames: [
          { $sort: { _id: 1 } },
          { $skip: opt.offset || 0 },
          { $limit: opt.limit || 10 },
        ],
        totalCount: [{ $count: 'count' }],
      })
      .allowDiskUse(true);

    return {
      usernames: result.usernames.map((r) => r._id),
      totalCount: result.totalCount[0]?.count ?? 0,
    };
  };

export default getOrCreateModel<ActivityDocument, ActivityModel>(
  'Activity',
  activitySchema,
);
