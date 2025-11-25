import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { IActivity, SupportedActionType } from '~/interfaces/activity';
import {
  ActionGroupSize,
  AllEssentialActions,
  AllLargeGroupActions,
  AllMediumGroupActions,
  AllSmallGroupActions,
  AllSupportedActions,
} from '~/interfaces/activity';
import type { ActivityDocument } from '~/server/models/activity';
import Activity from '~/server/models/activity';

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

class ActivityService {
  crowi!: Crowi;

  activityEvent: any;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.activityEvent = crowi.event('activity');

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
        let activity: ActivityDocument;
        const shoudUpdate = this.shoudUpdateActivity(parameters.action);

        if (shoudUpdate) {
          try {
            activity = await Activity.updateByParameters(
              activityId,
              parameters,
            );
          } catch (err) {
            logger.error('Update activity failed', err);
            return;
          }

          if (generatePreNotify != null) {
            const preNotify = generatePreNotify(
              activity,
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
        AllSmallGroupActions.forEach((action) =>
          availableActionsSet.add(action),
        );
        break;
      case ActionGroupSize.Medium:
        AllMediumGroupActions.forEach((action) =>
          availableActionsSet.add(action),
        );
        break;
      case ActionGroupSize.Large:
        AllLargeGroupActions.forEach((action) =>
          availableActionsSet.add(action),
        );
        break;
    }

    // Add additionalActions
    const additionalActions = parseActionString(auditLogAdditionalActions);
    additionalActions.forEach((action) => availableActionsSet.add(action));

    // Delete excludeActions
    const excludeActions = parseActionString(auditLogExcludeActions);
    excludeActions.forEach((action) => availableActionsSet.delete(action));

    // Add essentialActions
    if (isIncludeEssentialActions) {
      AllEssentialActions.forEach((action) => availableActionsSet.add(action));
    }

    return Array.from(availableActionsSet);
  };

  shoudUpdateActivity = function (action: SupportedActionType): boolean {
    return this.getAvailableActions().includes(action);
  };

  // for GET request
  createActivity = async function (parameters): Promise<IActivity | null> {
    const shoudCreateActivity = this.crowi.activityService.shoudUpdateActivity(
      parameters.action,
    );
    if (shoudCreateActivity) {
      let activity: IActivity;
      try {
        activity = await Activity.createByParameters(parameters);
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

module.exports = ActivityService;
