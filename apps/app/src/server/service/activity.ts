import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import { ContributionGraphActions } from '~/features/contribution-graph/interfaces/supported-actions';
import {
  ensureUserHasMigrated,
  resolveContributor,
} from '~/features/contribution-graph/server/services/contribution-migration-service';
import { addContribution } from '~/features/contribution-graph/server/services/contribution-service';
import type { IActivity, SupportedActionType } from '~/interfaces/activity';
import {
  ActionGroupSize,
  AllEssentialActions,
  AllLargeGroupActions,
  AllMediumGroupActions,
  AllSmallGroupActions,
  AllSupportedActions,
} from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import {
  pendingActivityContext,
  settleActivityRecord,
} from '~/server/service/activity/index';
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
 * Builds the `IActivity` that `GeneratePreNotify` reads to exclude the
 * acting user from a notification about their own action (pre-notify.ts:
 * `getIdForRef(actionUser)` on `activity.user`).
 *
 * `settleActivityRecord` creates the row via `createByParameters`, which
 * does NOT `include: { user: true }` (only `updateByParameters` does --
 * models/activity.ts Key Decision 5), so the settled row's `user` is always
 * absent. Re-attach the acting user's id from the context this listener
 * already `take`s from `pendingActivityContext` (`context.userId`), so the
 * notify path can still identify -- and exclude -- the actor. A bare id
 * string is a valid `Ref<IUser>` (`Ref<T> = string | ObjectId | T`), so no
 * cast is needed. Without this, the actor would receive a notification
 * about their own action (Requirement 2.3 regression; tasks.md
 * Implementation Note "2→5").
 *
 * Only this notify-construction input carries the injected `user` -- the
 * `updated` event itself is emitted with the original settle result. The
 * in-app-notification consumer (service/in-app-notification.ts) only reads
 * `_id`/`action`/`targetModel`/`target`/`snapshot` off that activity, never
 * `.user`, so it is unaffected either way.
 */
const toGeneratePreNotifyActivity = (
  activity: IActivity,
  actorId: string | undefined,
): IActivity => ({
  ...activity,
  user: actorId,
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
        // Take the pending context SYNCHRONOUSLY, before any `await` below
        // (Requirement 2.6). Taking it after an await would race
        // registerFailsafeFinalizer's `res` 'close'/'finish' cleanup, which
        // clears the same map entry -- a race could drop the IP/endpoint/
        // username/createdAt this listener needs to settle the row (design.md:
        // ActivityService update listener > Risks).
        const context = pendingActivityContext.take(activityId);

        const { contributor, ...activityParameters } = parameters;
        const shouldGenerateContribution = this.shouldGenerateContribution(
          parameters.action,
        );

        // Contribution handling MUST run before settle: the Activity row does
        // not exist yet at this point (lazy fail-safe creates it only inside
        // settleActivityRecord, below), so the migration aggregation does not
        // count it. addContribution's $inc accounts for this event; settling
        // the action afterward avoids a double count on a user's first
        // contribution. This must run regardless of record-eligibility
        // (Requirement 2.4: contribution is unaffected by the record gate).
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

        // Single source of truth for record-eligibility (Requirement 1.4/3.1)
        // -- settleActivityRecord never re-derives this itself, it only
        // consumes the injected result.
        const shouldPersist = this.shoudUpdateActivity(parameters.action);

        let activity: IActivity | null;
        try {
          activity = await settleActivityRecord({
            activityId,
            shouldPersist,
            context,
            activityParameters,
          });
        } catch (err) {
          logger.error('Settle activity failed', err);
          return;
        }

        // Notify ONLY when the row was actually created (in-gate AND
        // persisted -- Requirement 1.1/2.3). Both the out-of-gate branch
        // (settleActivityRecord returns null without writing) and a settle
        // failure (caught above) surface as "nothing to notify about".
        if (activity == null) {
          return;
        }

        if (generatePreNotify != null) {
          const preNotify = generatePreNotify(
            toGeneratePreNotifyActivity(activity, context?.userId),
            getAdditionalTargetUsers,
          );

          this.activityEvent.emit('updated', activity, target, preNotify);

          return;
        }

        this.activityEvent.emit('updated', activity, target);
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
