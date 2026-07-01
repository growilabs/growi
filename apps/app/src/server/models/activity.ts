import type { IUser, Ref } from '@growi/core';
import type { Document, Model } from 'mongoose';
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

const snapshotSchema = new Schema<ISnapshot>({
  username: { type: String, index: true },
});

// TODO: add revision id
const activitySchema = new Schema<ActivityDocument>(
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

// NOTE: export default is kept (not removed per mongoose-to-prisma Step 6) because
// service/activity.ts calls Activity.createIndexes() to register the TTL index, and
// integration specs seed the collection via this Mongoose model.  The Mongoose schema
// block above remains for collection/index registration (requirement 4.3) until all
// models have migrated to Prisma.
export default getOrCreateModel<ActivityDocument, Model<ActivityDocument>>(
  'Activity',
  activitySchema,
);

// ---------------------------------------------------------------------------
// Prisma Extension
// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
// ---------------------------------------------------------------------------
import { Prisma } from '~/generated/prisma/client';
import { normalizeAggregateRaw } from '~/server/util/prisma-raw-normalize';
import type { prisma } from '~/utils/prisma';

/**
 * The activities row shape returned by `updateByParameters` on success
 * (never null -- callers that may receive the not-found `null` case narrow
 * it themselves). `include: { user: true }` (Key Decision 5) means this
 * always carries a populated `user` relation alongside the `userId` scalar.
 *
 * Downstream consumers (pre-notify.ts, in-app-notification.ts) previously
 * typed this as the pre-migration Mongoose `ActivityDocument`; that type no
 * longer matches the actual runtime shape now that record/update goes
 * through Prisma (anticipated in design.md's Revalidation Triggers).
 */
export type ActivityWithUser = NonNullable<
  Awaited<ReturnType<typeof prisma.activities.updateByParameters>>
>;

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

type NullableIdUpdateField =
  | Prisma.NullableStringFieldUpdateOperationsInput
  | string
  | null
  | undefined;

/**
 * Normalizes an `updateByParameters` scalar reference field (`target`,
 * `event`, `userId`) to an ID string.
 *
 * Callers such as `update-page.ts`'s PAGE_UPDATE settle path pass the full
 * updated Mongoose Page document (or a bare ObjectId) for `target`, relying
 * on the auto-cast Mongoose's `findOneAndUpdate` used to perform. Prisma's
 * `update()` has no such casting and fails to serialize a Document/ObjectId
 * value passed as-is, so this mirrors `createByParameters`'s `normalizeToId`
 * for the update path.
 *
 * A Prisma field-update-operation object (`{ set: ... }`) is passed through
 * unchanged -- it is already valid Prisma input, not a loose Document/ObjectId
 * to normalize.
 */
function normalizeUpdateIdField(
  value: NullableIdUpdateField,
): NullableIdUpdateField {
  if (value == null || typeof value === 'string') return value;
  if ('set' in value) return value;
  return normalizeToId(value);
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

/**
 * Parameters accepted by updateByParameters.
 *
 * Uses Prisma's unchecked update input type — the activity extension only
 * updates scalar fields (action, snapshot, etc.) without relation nesting.
 * `activitiesUncheckedUpdateInput` maps directly to what callers pass
 * (e.g. `{ action: 'PAGE_VIEW', snapshot: ... }`) and is the correct Prisma
 * update payload for `context.update({ data: ... })`.
 */
export type IActivityUpdateParameters = Prisma.activitiesUncheckedUpdateInput;

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
         * Update an activity by ID, returning the updated document (with
         * populated user relation) or null when the record does not exist.
         *
         * Mirrors the existing Mongoose static `updateByParameters`:
         *   findOneAndUpdate({ _id }, params, { new: true }) → doc | null
         *
         * Key Decision 5: include: { user: true } so that downstream consumers
         * (pre-notify.ts, update-activity-logic.ts, in-app-notification.ts)
         * receive both `userId` (string) and `user` (relation) on the result.
         *
         * C1 (not-found semantics): Prisma `update` throws P2025 when no row
         * matches; we catch it and return null to preserve the existing null
         * return of findOneAndUpdate. Other errors are re-thrown unchanged.
         *
         * Requirements: 1.2, 5.3 — design.md: ActivityExtension Postconditions (C1),
         * Error Handling (更新対象なし P2025・C1), Key Decision 5.
         */
        async updateByParameters(
          activityId: string,
          parameters: IActivityUpdateParameters,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.activities>(this);

          // Normalize target/event/userId (see normalizeUpdateIdField) --
          // callers may pass a Mongoose Document or ObjectId instead of a
          // bare string, which Prisma cannot serialize unlike Mongoose's
          // auto-casting findOneAndUpdate.
          const normalizedParameters: IActivityUpdateParameters = {
            ...parameters,
            userId: normalizeUpdateIdField(parameters.userId),
            target: normalizeUpdateIdField(parameters.target),
            event: normalizeUpdateIdField(parameters.event),
          };

          try {
            return await context.update({
              where: { id: activityId },
              data: normalizedParameters,
              include: { user: true },
            });
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2025'
            ) {
              return null;
            }
            throw err;
          }
        },

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

        /**
         * Find snapshot usernames matching a regex, with a distinct total count.
         *
         * Reproduces the Mongoose static `findSnapshotUsernamesByUsernameRegexWithTotalCount`
         * via two Prisma `aggregateRaw` calls:
         *
         * 1. Usernames pipeline (same stage order as the Mongoose aggregate):
         *    $limit(10000) → $match(regex) → $group(_id) → $sort → $skip → $limit
         *    Maps each result `r._id` to a username string.
         *
         * 2. TotalCount pipeline (distinct count, reproduces distinct('snapshot.username').length):
         *    $match(regex) → $group(_id) → $count('total')
         *    Returns the `total` field, or 0 when the result is empty.
         *
         * R6 (design.md Open Questions): `q` is passed raw into `$regex` WITHOUT
         * escaping. This preserves the behavior of the Mongoose static, which also
         * passes `q` unescaped. Changing this would be a behavior change out of scope.
         *
         * Requirements: 3.4 — design.md: ActivityExtension Contracts (findSnapshotUsernames).
         */
        async findSnapshotUsernamesByUsernameRegexWithTotalCount(
          q: string,
          option: { sortOpt: 1 | -1; offset: number; limit: number },
        ): Promise<{ usernames: string[]; totalCount: number }> {
          const context =
            Prisma.getExtensionContext<typeof prisma.activities>(this);

          const opt = option || {};
          const sortOpt = opt.sortOpt || 1;
          const offset = opt.offset || 0;
          const limit = opt.limit || 10;

          // Usernames pipeline — stages match the Mongoose aggregate order exactly
          const usernamesPipeline = [
            { $limit: 10000 },
            { $match: { 'snapshot.username': { $regex: q, $options: 'i' } } },
            { $group: { _id: '$snapshot.username' } },
            { $sort: { _id: sortOpt } },
            { $skip: offset },
            { $limit: limit },
          ];

          // TotalCount pipeline — distinct username count via $count
          const totalCountPipeline = [
            { $match: { 'snapshot.username': { $regex: q, $options: 'i' } } },
            { $group: { _id: '$snapshot.username' } },
            { $count: 'total' },
          ];

          const [usernamesRaw, totalCountRaw] = await Promise.all([
            context.aggregateRaw({ pipeline: usernamesPipeline }),
            context.aggregateRaw({ pipeline: totalCountPipeline }),
          ]);

          // normalizeAggregateRaw handles BSON wrappers; after $group, _id is a
          // plain string (the username) — passed through unchanged.
          const usernamesNormalized = normalizeAggregateRaw(
            usernamesRaw,
          ) as Array<{ _id: string }>;
          const totalCountNormalized = normalizeAggregateRaw(
            totalCountRaw,
          ) as Array<{ total: number }>;

          const usernames = usernamesNormalized.map((r) => r._id);
          const totalCount = totalCountNormalized[0]?.total ?? 0;

          return { usernames, totalCount };
        },
      },
    },
  });
});
