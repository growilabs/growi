import type { IPage, IUser, Ref } from '@growi/core';
import mongoose from 'mongoose';

import { ContributionGraphActions } from '~/features/contribution-graph/interfaces/supported-actions';
import {
  ensureUserHasMigrated,
  resolveContributor,
} from '~/features/contribution-graph/server/services/contribution-migration-service';
import { addContribution } from '~/features/contribution-graph/server/services/contribution-service';
import type {
  IActivity,
  SupportedActionType,
  SupportedEventModelType,
  SupportedTargetModelType,
} from '~/interfaces/activity';
import {
  ActionGroupSize,
  AllEssentialActions,
  AllLargeGroupActions,
  AllMediumGroupActions,
  AllSmallGroupActions,
  AllSupportedActions,
} from '~/interfaces/activity';
import Activity, { type ActivityWithUser } from '~/server/models/activity';
import { prisma } from '~/utils/prisma';

import loggerFactory from '../../utils/logger';
import type Crowi from '../crowi';
import type { GeneratePreNotify, GetAdditionalTargetUsers } from './pre-notify';

const logger = loggerFactory('growi:service:ActivityService');

const parseActionString = (actionsString: string): SupportedActionType[] => {
  if (actionsString == null) {
    return [];
  }

  const actions = actionsString.split(',').map((value) => value.trim());
  return actions.filter((action) =>
    (AllSupportedActions as string[]).includes(action),
  ) as SupportedActionType[];
};

/**
 * Converts a Prisma `activities` row (updateByParameters's result, populated
 * via `include: { user: true }`) to the `IActivity` shape `GeneratePreNotify`
 * expects. Prisma's scalar reference fields (`user`, `target`, `event`, ...)
 * are `| null` when unset; `IActivity`'s are `| undefined` (no `null`). The
 * populated `users` row also has nullable fields (e.g. `name: string | null`)
 * where `IUser` requires non-nullable -- at runtime they map to the same
 * MongoDB document (same cast pattern as apiv3/activity.ts's
 * serializeUserSecurely call). Tier-2 rationale: the cast is confined to this
 * single conversion, not spread across call sites.
 */
const toGeneratePreNotifyActivity = (
  activity: ActivityWithUser,
): IActivity => ({
  ...activity,
  action: activity.action as SupportedActionType,
  user: (activity.user ?? undefined) as Ref<IUser> | undefined,
  target: activity.target ?? undefined,
  targetModel: (activity.targetModel ?? undefined) as
    | SupportedTargetModelType
    | undefined,
  event: activity.event ?? undefined,
  eventModel: (activity.eventModel ?? undefined) as
    | SupportedEventModelType
    | undefined,
  // The ActivitiesSnapshot composite fields are optional in schema.prisma,
  // so Prisma materializes absent fields as `null`; ISnapshot models absence
  // as `undefined` (missing field), so coerce null -> undefined per field.
  snapshot: {
    ...activity.snapshot,
    username: activity.snapshot.username ?? undefined,
    originalName: activity.snapshot.originalName ?? undefined,
    pagePath: activity.snapshot.pagePath ?? undefined,
    pageId: activity.snapshot.pageId ?? undefined,
    fileSize: activity.snapshot.fileSize ?? undefined,
  },
});

class ActivityService {
  crowi!: Crowi;

  activityEvent: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityEvent = crowi.events.activity;

    this.getAvailableActions = this.getAvailableActions.bind(this);
    this.shoudUpdateActivity = this.shoudUpdateActivity.bind(this);

    this.initActivityEventListeners();
  }

  initActivityEventListeners(): void {
    this.activityEvent.on(
      'update',
      async (
        activityId: string,
        parameters,
        target: IPage,
        generatePreNotify?: GeneratePreNotify,
        getAdditionalTargetUsers?: GetAdditionalTargetUsers,
      ) => {
        let activity: Awaited<
          ReturnType<typeof prisma.activities.updateByParameters>
        >;
        const { contributor, ...activityParameters } = parameters;
        const shoudUpdate = this.shoudUpdateActivity(parameters.action);
        const shouldGenerateContribution = this.shouldGenerateContribution(
          parameters.action,
        );

        // Contribution handling MUST run before updateByParameters: the Activity is
        // still ACTION_UNSETTLED at this point, so the migration aggregation does not count it.
        // addContribution's $inc accounts for this event; settling the action afterward avoids
        // a double count on a user's first contribution.
        if (shouldGenerateContribution) {
          try {
            const contributorUser = await resolveContributor(
              activityId,
              contributor,
            );

            if (contributorUser != null) {
              await ensureUserHasMigrated(contributorUser);
              await addContribution(contributorUser._id.toString());
            } else {
              logger.warn(
                'Could not find a valid user for contribution snapshot.',
              );
            }
          } catch (error) {
            logger.error(
              'Failed to process contribution migration sequence:',
              error,
            );
          }
        }

        if (shoudUpdate) {
          try {
            activity = await prisma.activities.updateByParameters(
              activityId,
              activityParameters,
            );
          } catch (err) {
            logger.error('Update activity failed', err);
            return;
          }

          // updateByParameters returns null when activityId matches no row
          // (C1 not-found semantics, e.g. P2025) -- nothing was updated, so
          // there is nothing to notify about.
          if (activity == null) {
            return;
          }

          if (generatePreNotify != null) {
            const preNotify = generatePreNotify(
              toGeneratePreNotifyActivity(activity),
              getAdditionalTargetUsers,
            );

            this.activityEvent.emit('updated', activity, target, preNotify);

            return;
          }

          this.activityEvent.emit('updated', activity, target);
        }
      },
    );
  }

  getAvailableActions = function (
    isIncludeEssentialActions = true,
  ): SupportedActionType[] {
    const auditLogEnabled =
      this.crowi.configManager.getConfig('app:auditLogEnabled') || false;
    const auditLogActionGroupSize =
      this.crowi.configManager.getConfig('app:auditLogActionGroupSize') ||
      ActionGroupSize.Small;
    const auditLogAdditionalActions = this.crowi.configManager.getConfig(
      'app:auditLogAdditionalActions',
    );
    const auditLogExcludeActions = this.crowi.configManager.getConfig(
      'app:auditLogExcludeActions',
    );

    if (!auditLogEnabled) {
      return AllEssentialActions;
    }

    const availableActionsSet = new Set<SupportedActionType>();

    // Set base action group
    switch (auditLogActionGroupSize) {
      case ActionGroupSize.Small:
        AllSmallGroupActions.forEach((action) => {
          availableActionsSet.add(action);
        });
        break;
      case ActionGroupSize.Medium:
        AllMediumGroupActions.forEach((action) => {
          availableActionsSet.add(action);
        });
        break;
      case ActionGroupSize.Large:
        AllLargeGroupActions.forEach((action) => {
          availableActionsSet.add(action);
        });
        break;
    }

    // Add additionalActions
    const additionalActions = parseActionString(auditLogAdditionalActions);
    additionalActions.forEach((action) => {
      availableActionsSet.add(action);
    });

    // Delete excludeActions
    const excludeActions = parseActionString(auditLogExcludeActions);
    excludeActions.forEach((action) => {
      availableActionsSet.delete(action);
    });

    // Add essentialActions
    if (isIncludeEssentialActions) {
      AllEssentialActions.forEach((action) => {
        availableActionsSet.add(action);
      });
    }

    return Array.from(availableActionsSet);
  };

  shoudUpdateActivity = function (action: SupportedActionType): boolean {
    return this.getAvailableActions().includes(action);
  };

  shouldGenerateContribution = (action: SupportedActionType): boolean => {
    const contributionActions: readonly SupportedActionType[] = Object.values(
      ContributionGraphActions,
    );
    return contributionActions.includes(action);
  };

  // for GET request
  createActivity = async function (parameters): Promise<IActivity | null> {
    const shoudCreateActivity = this.crowi.activityService.shoudUpdateActivity(
      parameters.action,
    );
    if (shoudCreateActivity) {
      let activity: IActivity;
      try {
        activity = await prisma.activities.createByParameters(parameters);
        return activity;
      } catch (err) {
        logger.error('Create activity failed', err);
      }
    }
    return null;
  };

  createTtlIndex = async function () {
    const configManager = this.crowi.configManager;
    const activityExpirationSeconds =
      configManager != null
        ? configManager.getConfig('app:activityExpirationSeconds')
        : 2592000;

    try {
      // create the collection with indexes at first
      await Activity.createIndexes();

      const collection = mongoose.connection.collection('activities');
      const indexes = await collection.indexes();

      const targetField = 'createdAt_1';
      const foundCreatedAt = indexes.find((i) => i.name === targetField);

      const isNotSpec =
        foundCreatedAt?.expireAfterSeconds == null ||
        foundCreatedAt?.expireAfterSeconds !== activityExpirationSeconds;
      const shoudDropIndex = foundCreatedAt != null && isNotSpec;
      const shoudCreateIndex = foundCreatedAt == null || shoudDropIndex;

      if (shoudDropIndex) {
        await collection.dropIndex(targetField);
      }

      if (shoudCreateIndex) {
        await collection.createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: activityExpirationSeconds },
        );
      }
    } catch (err) {
      logger.error('Failed to create TTL Index', err);
      throw err;
    }
  };
}

export default ActivityService;
