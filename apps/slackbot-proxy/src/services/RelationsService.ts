import {
  type IChannelOptionalId,
  REQUEST_TIMEOUT_FOR_PTOG,
} from '@growi/slack';
import { getSupportedGrowiActionsRegExp } from '@growi/slack/dist/utils/get-supported-growi-actions-regexps';
import { permissionParser } from '@growi/slack/dist/utils/permission-parser';
import { Inject, Service } from '@tsed/di';
import axios from 'axios';
import { addHours } from 'date-fns/addHours';

import { PermissionSettingsInterface, Relation } from '~/entities/relation';
import { RelationRepository } from '~/repositories/relation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('slackbot-proxy:services:RelationsService');

type CheckPermissionForInteractionsResults = {
  allowedRelations: Relation[];
  disallowedGrowiUrls: Set<string>;
  commandName: string;
  rejectedResults: PromiseRejectedResult[];
};

type CheckEachRelationResult = {
  allowedRelation: Relation | null;
  disallowedGrowiUrl: string | null;
  eachRelationCommandName: string;
};

@Service()
export class RelationsService {
  @Inject()
  relationRepository: RelationRepository;

  async resetAllExpiredAtCommands(): Promise<void> {
    await this.relationRepository.update(
      {},
      { expiredAtCommands: new Date('2000-01-01') },
    );
  }

  private async getSupportedGrowiCommands(relation: Relation): Promise<any> {
    // generate API URL
    const url = new URL(
      '/_api/v3/slack-integration/supported-commands',
      relation.growiUri,
    );
    return axios.get(url.toString(), {
      headers: {
        'x-growi-ptog-tokens': relation.tokenPtoG,
      },
      timeout: REQUEST_TIMEOUT_FOR_PTOG,
    });
  }

  private async syncSupportedGrowiCommands(
    relation: Relation,
  ): Promise<Relation> {
    const res = await this.getSupportedGrowiCommands(relation);

    // support both of v4.4.x and v4.5.x
    // see: https://redmine.weseek.co.jp/issues/82985
    const {
      permissionsForBroadcastUseCommands,
      permissionsForSingleUseCommands,
    } = res.data.data ?? res.data;

    if (relation !== null) {
      relation.permissionsForBroadcastUseCommands =
        permissionsForBroadcastUseCommands;
      relation.permissionsForSingleUseCommands =
        permissionsForSingleUseCommands;
      relation.expiredAtCommands = addHours(new Date(), 48);
      return this.relationRepository.save(relation);
    }
    throw Error('No relation exists.');
  }

  private async syncRelation(relation: Relation): Promise<Relation> {
    // TODO use assert (relation != null)

    const isDataNull =
      relation.permissionsForBroadcastUseCommands == null ||
      relation.permissionsForBroadcastUseCommands == null;
    const distanceMillisecondsToExpiredAt =
      relation.getDistanceInMillisecondsToExpiredAt(new Date());
    const isExpired = distanceMillisecondsToExpiredAt < 0;

    if (isDataNull || isExpired) {
      return this.syncSupportedGrowiCommands(relation);
    }

    // 24 hours
    const isLimitUnder24Hours =
      distanceMillisecondsToExpiredAt < 24 * 60 * 60 * 1000;
    if (isLimitUnder24Hours) {
      this.syncSupportedGrowiCommands(relation);
    }
    return relation;
  }

  private isPermitted(
    permissionSettings: PermissionSettingsInterface,
    growiCommandType: string,
    channel: IChannelOptionalId,
  ): boolean {
    // TODO assert (permissionSettings != null)

    const permissionForCommand = permissionSettings[growiCommandType];

    return permissionParser(permissionForCommand, channel);
  }

  async isPermissionsForSingleUseCommands(
    relation: Relation,
    growiCommandType: string,
    channel: IChannelOptionalId,
  ): Promise<boolean> {
    // TODO assert (relation != null)
    if (relation == null) {
      return false;
    }

    let relationToEval = relation;

    try {
      relationToEval = await this.syncRelation(relation);
    } catch (err) {
      logger.error('failed to sync', err);
      return false;
    }

    // TODO assert (relationToEval.permissionsForSingleUseCommands != null) because syncRelation success

    return this.isPermitted(
      relationToEval.permissionsForSingleUseCommands,
      growiCommandType,
      channel,
    );
  }

  async isPermissionsUseBroadcastCommands(
    relation: Relation,
    growiCommandType: string,
    channel: IChannelOptionalId,
  ): Promise<boolean> {
    // TODO assert (relation != null)
    if (relation == null) {
      return false;
    }

    let relationToEval = relation;

    try {
      relationToEval = await this.syncRelation(relation);
    } catch (err) {
      logger.error('failed to sync', err);
      return false;
    }

    // TODO assert (relationToEval.permissionsForSingleUseCommands != null) because syncRelation success

    return this.isPermitted(
      relationToEval.permissionsForBroadcastUseCommands,
      growiCommandType,
      channel,
    );
  }

  async checkPermissionForInteractions(
    relations: Relation[],
    actionId: string,
    callbackId: string,
    channel: IChannelOptionalId,
  ): Promise<CheckPermissionForInteractionsResults> {
    const allowedRelations: Relation[] = [];
    const disallowedGrowiUrls: Set<string> = new Set();
    let commandName = '';

    const results = await Promise.allSettled(
      relations.map((relation) => {
        const relationResult = this.checkEachRelation(
          relation,
          actionId,
          callbackId,
          channel,
        );
        const { allowedRelation, disallowedGrowiUrl, eachRelationCommandName } =
          relationResult;

        if (allowedRelation != null) {
          allowedRelations.push(allowedRelation);
        }
        if (disallowedGrowiUrl != null) {
          disallowedGrowiUrls.add(disallowedGrowiUrl);
        }
        commandName = eachRelationCommandName;
        return relationResult;
      }),
    );

    // Pick up only a relation which status is "rejected" in results. Like bellow
    const rejectedResults: PromiseRejectedResult[] = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    return {
      allowedRelations,
      disallowedGrowiUrls,
      commandName,
      rejectedResults,
    };
  }

  checkEachRelation(
    relation: Relation,
    actionId: string,
    callbackId: string,
    channel: IChannelOptionalId,
  ): CheckEachRelationResult {
    let allowedRelation: Relation | null = null;
    let disallowedGrowiUrl: string | null = null;
    let eachRelationCommandName = '';

    let permissionForInteractions: boolean | string[];
    const singleUse = Object.keys(relation.permissionsForSingleUseCommands);
    const broadCastUse = Object.keys(
      relation.permissionsForBroadcastUseCommands,
    );

    [...singleUse, ...broadCastUse].forEach(async (tempCommandName) => {
      // ex. search OR search:handlerName
      const commandRegExp = getSupportedGrowiActionsRegExp(tempCommandName);
      // skip this forEach loop if the requested command is not in permissionsForBroadcastUseCommands and permissionsForSingleUseCommands
      if (!commandRegExp.test(actionId) && !commandRegExp.test(callbackId)) {
        return;
      }

      eachRelationCommandName = tempCommandName;

      // case: singleUse
      permissionForInteractions =
        relation.permissionsForSingleUseCommands[tempCommandName];
      // case: broadcastUse
      if (permissionForInteractions == null) {
        permissionForInteractions =
          relation.permissionsForBroadcastUseCommands[tempCommandName];
      }

      if (permissionForInteractions === true) {
        allowedRelation = relation;
        return;
      }

      // check permission at channel level
      if (Array.isArray(permissionForInteractions)) {
        if (permissionForInteractions.includes(channel.name)) {
          allowedRelation = relation;
          return;
        }

        if (channel.id == null) return;

        if (permissionForInteractions.includes(channel.id)) {
          allowedRelation = relation;
          return;
        }
      }

      disallowedGrowiUrl = relation.growiUri;
    });

    return { allowedRelation, disallowedGrowiUrl, eachRelationCommandName };
  }
}
