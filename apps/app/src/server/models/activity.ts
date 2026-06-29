import type { IUser, Ref } from '@growi/core';
import type { Document, Model, SortOrder } from 'mongoose';
import { Schema, Types } from 'mongoose';
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

activitySchema.statics.findSnapshotUsernamesByUsernameRegexWithTotalCount =
  async function (
    q: string,
    option: { sortOpt: SortOrder; offset: number; limit: number },
  ): Promise<{ usernames: string[]; totalCount: number }> {
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

    const totalCount = (
      await this.find(conditions).distinct('snapshot.username')
    ).length;

    return { usernames: usernames.map((r) => r._id), totalCount };
  };

export default getOrCreateModel<ActivityDocument, ActivityModel>(
  'Activity',
  activitySchema,
);

// ---------------------------------------------------------------------------
// Prisma Extension
// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
// ---------------------------------------------------------------------------
import { Prisma } from '~/generated/prisma/client';
import type { prisma } from '~/utils/prisma';

/**
 * Normalize a user/target argument to an ObjectId string.
 *
 * Callers (e.g. service/page/index.ts) may pass a Mongoose document or
 * plain object rather than a bare ID string.  Prisma's create() requires a
 * string ObjectId, so we coerce here to keep callers unchanged.
 *
 * Exported for unit-testing the normalization logic in isolation.
 */
export function normalizeToId(value: unknown): string | null | undefined {
  if (value == null) return value as null | undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const id = obj._id ?? obj.id;
    if (id != null) return String(id);
  }
  return String(value);
}

/**
 * Parameters accepted by createByParameters — mirrors the Mongoose static's
 * caller interface.  `user` and `target` may be either a bare ID string or a
 * Mongoose document / plain object (normalization is done inside the method).
 */
export type IActivityParameters = {
  user?: unknown;
  target?: unknown;
  targetModel?: string;
  eventModel?: string;
  event?: unknown;
  ip?: string;
  endpoint?: string;
  action: string;
  snapshot?: { username?: string };
  createdAt?: Date;
};

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      activities: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      activities: {
        /**
         * Create an activity from parameters.
         *
         * Mirrors the existing Mongoose static `createByParameters`.
         * Defensively normalizes `user` and `target` from objects to ID
         * strings so callers that pass Mongoose documents work unchanged
         * (Key Decision 4: normalization lives inside the extension).
         *
         * Defaults:
         *   v        = 0  (Mongoose initialises __v to 0 on create)
         *   createdAt = now  (Mongoose timestamps: { createdAt: true })
         *   snapshot.id = new ObjectId string (composite type requires it)
         */
        async createByParameters(
          parameters: IActivityParameters,
        ): Promise<IActivity> {
          const context =
            Prisma.getExtensionContext<typeof prisma.activities>(this);

          const { user, target, event, snapshot, createdAt, ...rest } =
            parameters;

          // Build the snapshot composite type Prisma requires:
          // ActivitiesSnapshotCreateInput = { id: string; username: string }
          // The snapshot.id maps to _id in the ActivitiesSnapshot composite.
          // Generate a new ObjectId hex string when not provided by the caller.
          const snapshotId = new Types.ObjectId().toString();
          const snapshotData: Prisma.activitiesUncheckedCreateInput['snapshot'] =
            {
              id: snapshotId,
              username: snapshot?.username ?? '',
            };

          const data: Prisma.activitiesUncheckedCreateInput = {
            ...rest,
            v: 0,
            createdAt: createdAt ?? new Date(),
            ip: rest.ip ?? '',
            endpoint: rest.endpoint ?? '',
            userId: normalizeToId(user) ?? undefined,
            target: normalizeToId(target) ?? undefined,
            event: normalizeToId(event) ?? undefined,
            snapshot: snapshotData,
          };

          const activity = await context.create({ data });
          return activity as unknown as IActivity;
        },
      },
    },
  });
});
