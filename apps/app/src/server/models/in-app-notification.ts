import type { IUser } from '@growi/core/dist/interfaces';
import {
  serializeUserSecurely,
  toLegacyAttachmentShape,
  toLegacyUserShape,
} from '@growi/core/dist/models/serializers';
import { Schema } from 'mongoose';

import type {
  activities,
  attachments,
  auditlogbulkexportjobs,
  inappnotifications,
  pagebulkexportjobs,
  users,
} from '~/generated/prisma/client';
import { Prisma } from '~/generated/prisma/client';
import {
  AllSupportedActions,
  AllSupportedTargetModels,
  SupportedTargetModel,
} from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import { toRawDate, toRawObjectId } from '~/server/util/prisma-raw-normalize';
import type { PaginateResult, prisma } from '~/utils/prisma';

import { getOrCreateModel } from '../util/mongoose-utils';

const { STATUS_UNOPENED } = InAppNotificationStatuses;

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const inAppNotificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    targetModel: {
      type: String,
      required: true,
      enum: AllSupportedTargetModels,
    },
    target: {
      type: Schema.Types.ObjectId,
      refPath: 'targetModel',
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: AllSupportedActions,
    },
    activities: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Activity',
      },
    ],
    status: {
      type: String,
      default: STATUS_UNOPENED,
      enum: InAppNotificationStatuses,
      index: true,
      required: true,
    },
    snapshot: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
inAppNotificationSchema.index({ createdAt: 1 });
inAppNotificationSchema.index({
  user: 1,
  target: 1,
  action: 1,
  createdAt: 1,
});

getOrCreateModel('InAppNotification', inAppNotificationSchema);

const UPSERT_BATCH_SIZE = 1000;

// Page is not migrated to Prisma yet; the caller supplies the read so this
// extension does not depend on the Mongoose model registry.
export type PageLoader = (
  pageIds: string[],
) => Promise<Array<{ _id: { toString(): string } }>>;

export interface UpsertByActivityParams {
  userIds: string[];
  activityId: string;
  targetModel: string;
  // null for activities that have no single target (e.g. empty trash)
  target: string | null;
  action: string;
  // null for targets that have no snapshot (e.g. User, AuditLogBulkExportJob)
  snapshot: string | null;
  createdAt: Date;
  lastWeek: Date;
}

type ActivityWithUser = Omit<activities, 'snapshot'> & { user: users | null };

// `userId` is replaced by whatever the caller includes (e.g. `user`); activities
// and target are resolved here because they are not Prisma relations.
export type WithHydratedTarget<R> = Omit<
  R,
  'userId' | 'activities' | 'target'
> & {
  activities: ActivityWithUser[];
  target: unknown;
};

export type HydratedNotification = WithHydratedTarget<
  Prisma.inappnotificationsGetPayload<{ include: { user: true } }>
>;

const toLegacyJobShape = <
  J extends {
    userId: string;
    attachmentId: string | null;
    attachment: attachments | null;
  },
>(
  job: J,
) => {
  const { attachment, ...rest } = job;
  return {
    ...rest,
    user: job.userId,
    attachment:
      attachment != null
        ? toLegacyAttachmentShape(attachment)
        : job.attachmentId,
  };
};

const byId = <T extends { id: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.id, row]));

type Attached = { attachment: attachments | null };

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      inappnotifications: {
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
      inappnotifications: {
        /**
         * Paginate the notifications and attach user, activities (with their
         * users) and the polymorphic target (resolved by `targetModel`), which
         * Mongoose used to `populate`.
         */
        async paginateAndIncludeTarget<
          const A extends Pick<
            Prisma.inappnotificationsFindManyArgs,
            'where' | 'orderBy' | 'include'
          >,
        >(
          // `Pick` alone does not reject extra keys on an inferred `A`, so
          // `select` / `omit` are closed off explicitly
          options: A & {
            offset?: number;
            limit?: number;
            select?: never;
            omit?: never;
          },
          loadPages: PageLoader,
        ): Promise<
          PaginateResult<
            WithHydratedTarget<Prisma.inappnotificationsGetPayload<A>>
          >
        > {
          const context =
            Prisma.getExtensionContext<typeof prisma.inappnotifications>(this);
          const result = await context.paginate(options);
          // `A` is generic here, so the payload cannot be narrowed to the base
          // row type without an assertion; `A` has no `select`/`omit`, so the
          // base fields are always present
          const rows = result.docs as unknown as inappnotifications[];
          // `client` at this chain position has every delegate read below, but
          // its parameter type cannot express them
          const db = client as unknown as Pick<
            typeof prisma,
            | 'users'
            | 'activities'
            | 'pagebulkexportjobs'
            | 'auditlogbulkexportjobs'
            | 'attachments'
          >;

          // Mongoose `refPath` populate replaced by hand: group the target ids
          // by `targetModel`, fetch each group once, and key by model + id.
          // A target that no longer exists resolves to null.
          const idsOf = (targetModel: string) => [
            ...new Set(
              rows
                .filter((row) => row.targetModel === targetModel)
                .flatMap((row) => row.target ?? []),
            ),
          ];
          const pageIds = idsOf(SupportedTargetModel.MODEL_PAGE);
          const userIds = idsOf(SupportedTargetModel.MODEL_USER);
          const pageJobIds = idsOf(
            SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
          );
          const auditJobIds = idsOf(
            SupportedTargetModel.MODEL_AUDIT_LOG_BULK_EXPORT_JOB,
          );
          const attachmentIds = idsOf(SupportedTargetModel.MODEL_ATTACHMENT);
          const activityIds = [
            ...new Set(rows.flatMap((row) => row.activities)),
          ];

          const [
            activityRows,
            pages,
            targetUsers,
            pageJobs,
            auditJobs,
            targetAttachments,
          ] = await Promise.all([
            activityIds.length === 0
              ? []
              : db.activities.findMany({
                  where: { id: { in: activityIds } },
                  // snapshot is a required composite that legacy activities may
                  // lack; only the user is needed here
                  omit: { snapshot: true },
                  include: { user: true },
                }),
            pageIds.length === 0 ? [] : loadPages(pageIds),
            userIds.length === 0
              ? []
              : db.users.findMany({ where: { id: { in: userIds } } }),
            pageJobIds.length === 0
              ? []
              : db.pagebulkexportjobs.findMany({
                  where: { id: { in: pageJobIds } },
                  include: { attachment: true },
                }),
            auditJobIds.length === 0
              ? []
              : db.auditlogbulkexportjobs.findMany({
                  where: { id: { in: auditJobIds } },
                  include: { attachment: true },
                }),
            attachmentIds.length === 0
              ? []
              : db.attachments.findMany({
                  where: { id: { in: attachmentIds } },
                }),
          ]);

          const targets = new Map<string, unknown>();
          for (const page of pages) {
            targets.set(`${SupportedTargetModel.MODEL_PAGE}:${page._id}`, page);
          }
          for (const user of targetUsers) {
            targets.set(
              `${SupportedTargetModel.MODEL_USER}:${user.id}`,
              serializeUserSecurely(toLegacyUserShape(user) as IUser),
            );
          }
          const jobs: Array<
            [
              string,
              Array<(pagebulkexportjobs | auditlogbulkexportjobs) & Attached>,
            ]
          > = [
            [SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB, pageJobs],
            [SupportedTargetModel.MODEL_AUDIT_LOG_BULK_EXPORT_JOB, auditJobs],
          ];
          for (const [targetModel, jobRows] of jobs) {
            for (const job of jobRows) {
              targets.set(`${targetModel}:${job.id}`, toLegacyJobShape(job));
            }
          }
          for (const attachment of targetAttachments) {
            targets.set(
              `${SupportedTargetModel.MODEL_ATTACHMENT}:${attachment.id}`,
              toLegacyAttachmentShape(attachment),
            );
          }

          // A change proposal holds every operation (paths and bodies), while a
          // recipient may only see its own snapshot, so it is never loaded.
          for (const row of rows) {
            if (
              row.targetModel === SupportedTargetModel.MODEL_CHANGE_PROPOSAL &&
              row.target != null
            ) {
              targets.set(`${row.targetModel}:${row.target}`, {
                _id: row.target,
              });
            }
          }

          const activitiesById = byId(activityRows);

          return {
            ...result,
            docs: rows.map(({ userId, activities, target, ...rest }) => ({
              ...rest,
              activities: activities.flatMap(
                (id) => activitiesById.get(id) ?? [],
              ),
              target:
                target != null
                  ? (targets.get(`${rest.targetModel}:${target}`) ?? null)
                  : null,
            })) as unknown as Array<
              WithHydratedTarget<Prisma.inappnotificationsGetPayload<A>>
            >,
          };
        },
        /**
         * Merge into the user's notification for the same target/action/snapshot
         * created within the dedup window, or create it. Raw `update` is used
         * because Prisma has neither `$addToSet` nor an atomic upsert on a
         * non-unique filter.
         */
        async upsertByActivity(params: UpsertByActivityParams): Promise<void> {
          const {
            userIds,
            activityId,
            targetModel,
            target,
            action,
            snapshot,
            createdAt,
            lastWeek,
          } = params;
          // duplicates would race: two unordered upserts can both miss and insert
          const uniqueUserIds = [...new Set(userIds)];
          if (uniqueUserIds.length === 0) {
            return;
          }

          // One update command is capped at 100,000 statements / ~16MB, so a
          // very large recipient list is sent in chunks
          for (let i = 0; i < uniqueUserIds.length; i += UPSERT_BATCH_SIZE) {
            const result = await client.$runCommandRaw({
              update: 'inappnotifications',
              ordered: false,
              updates: uniqueUserIds
                .slice(i, i + UPSERT_BATCH_SIZE)
                .map((userId) => ({
                  q: {
                    user: toRawObjectId(userId),
                    target: target != null ? toRawObjectId(target) : null,
                    action,
                    createdAt: { $gt: toRawDate(lastWeek) },
                    snapshot,
                  },
                  u: {
                    $set: {
                      user: toRawObjectId(userId),
                      targetModel,
                      target: target != null ? toRawObjectId(target) : null,
                      action,
                      status: STATUS_UNOPENED,
                      createdAt: toRawDate(createdAt),
                      snapshot,
                    },
                    $addToSet: { activities: toRawObjectId(activityId) },
                    $setOnInsert: { __v: 0 },
                  },
                  upsert: true,
                })),
            });

            // $runCommandRaw reports per-document failures with ok: 1 instead of throwing
            if (
              result.writeErrors != null ||
              result.writeConcernError != null
            ) {
              throw new Error(
                `Failed to upsert inappnotifications: ${JSON.stringify(result)}`,
              );
            }
          }
        },
      },
    },
  });
});
