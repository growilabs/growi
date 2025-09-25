import type { IUserHasId } from '@growi/core';

import type { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import { SocketEventName } from '~/interfaces/websocket';
import ExternalAccount from '~/server/models/external-account';
import S2sMessage from '~/server/models/vo/s2s-message';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';
import type { S2sMessageHandlable } from '~/server/service/s2s-messaging/handlable';
import { excludeTestIdsFromTargetIds } from '~/server/util/compare-objectId';
import loggerFactory from '~/utils/logger';
import { batchProcessPromiseAll } from '~/utils/promise';

import { configManager } from '../../../../server/service/config-manager';
import { externalAccountService } from '../../../../server/service/external-account';
import type {
  ExternalGroupProviderType,
  ExternalUserGroupTreeNode,
  ExternalUserInfo,
  IExternalUserGroupHasId,
} from '../../interfaces/external-user-group';
import ExternalUserGroup from '../models/external-user-group';
import ExternalUserGroupRelation from '../models/external-user-group-relation';

const logger = loggerFactory('growi:service:external-user-group-sync-service');

// When d = max depth of group trees
// Max space complexity of syncExternalUserGroups will be:
// O(TREES_BATCH_SIZE * d * USERS_BATCH_SIZE)
const TREES_BATCH_SIZE = 10;
const USERS_BATCH_SIZE = 30;

type SyncStatus = {
  isExecutingSync: boolean;
  totalCount: number;
  count: number;
};

class ExternalUserGroupSyncS2sMessage extends S2sMessage {
  syncStatus: SyncStatus;
}

abstract class ExternalUserGroupSyncService implements S2sMessageHandlable {
  groupProviderType: ExternalGroupProviderType; // name of external service that contains user group info (e.g: ldap, keycloak)

  authProviderType: IExternalAuthProviderType | null; // auth provider type (e.g: ldap, oidc). Has to be set before syncExternalUserGroups execution.

  socketIoService: any;

  s2sMessagingService: S2sMessagingService | null;

  syncStatus: SyncStatus = { isExecutingSync: false, totalCount: 0, count: 0 };

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(
    groupProviderType: ExternalGroupProviderType,
    s2sMessagingService: S2sMessagingService | null,
    socketIoService,
  ) {
    this.groupProviderType = groupProviderType;
    this.s2sMessagingService = s2sMessagingService;
    this.socketIoService = socketIoService;
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage: ExternalUserGroupSyncS2sMessage): boolean {
    return s2sMessage.eventName === 'switchExternalUserGroupExecSyncStatus';
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(
    s2sMessage: ExternalUserGroupSyncS2sMessage,
  ): Promise<void> {
    logger.info('Update syncStatus by pubsub notification');
    this.syncStatus = s2sMessage.syncStatus;
  }

  async setSyncStatus(syncStatus: SyncStatus): Promise<void> {
    this.syncStatus = syncStatus;

    if (this.s2sMessagingService != null) {
      const s2sMessage = new ExternalUserGroupSyncS2sMessage(
        'switchExternalUserGroupExecSyncStatus',
        {
          syncStatus: this.syncStatus,
        },
      );

      try {
        await this.s2sMessagingService.publish(s2sMessage);
      } catch (e) {
        logger.error(
          'Failed to publish update message with S2sMessagingService: ',
          e.message,
        );
      }
    }
  }

  /** External user group tree sync method
   * 1. Generate external user group tree
   * 2. Use createUpdateExternalUserGroup on each node in the tree using DFS
   * 3. If preserveDeletedLDAPGroups is false、delete all ExternalUserGroups that were not found during tree search
   */
  async syncExternalUserGroups(): Promise<void> {
    if (this.authProviderType == null)
      throw new Error('auth provider type is not set');
    if (this.syncStatus.isExecutingSync)
      throw new Error('External user group sync is already being executed');

    const preserveDeletedLdapGroups = configManager.getConfig(
      `external-user-group:${this.groupProviderType}:preserveDeletedGroups`,
    );
    const existingExternalUserGroupIds: string[] = [];

    const socket = this.socketIoService?.getAdminSocket();

    const syncNode = async (
      node: ExternalUserGroupTreeNode,
      parentId?: string,
    ) => {
      const externalUserGroup = await this.createUpdateExternalUserGroup(
        node,
        parentId,
      );
      existingExternalUserGroupIds.push(externalUserGroup._id);
      await this.setSyncStatus({
        isExecutingSync: true,
        totalCount: this.syncStatus.totalCount,
        count: this.syncStatus.count + 1,
      });
      socket?.emit(
        SocketEventName.externalUserGroup[this.groupProviderType]
          .GroupSyncProgress,
        {
          totalCount: this.syncStatus.totalCount,
          count: this.syncStatus.count,
        },
      );
      // Do not use Promise.all, because the number of promises processed can
      // exponentially grow when group tree is enormous
      for await (const childNode of node.childGroupNodes) {
        await syncNode(childNode, externalUserGroup._id);
      }
    };

    try {
      const trees = await this.generateExternalUserGroupTrees();
      const totalCount = trees
        .map((tree) => this.getGroupCountOfTree(tree))
        .reduce((sum, current) => sum + current);

      await this.setSyncStatus({ isExecutingSync: true, totalCount, count: 0 });

      await batchProcessPromiseAll(trees, TREES_BATCH_SIZE, async (tree) => {
        return syncNode(tree);
      });

      if (!preserveDeletedLdapGroups) {
        await ExternalUserGroup.deleteMany({
          _id: { $nin: existingExternalUserGroupIds },
          groupProviderType: this.groupProviderType,
          provider: this.groupProviderType,
        });
        await ExternalUserGroupRelation.removeAllInvalidRelations();
      }
      socket?.emit(
        SocketEventName.externalUserGroup[this.groupProviderType]
          .GroupSyncCompleted,
      );
    } catch (e) {
      logger.error(e.message);
      socket?.emit(
        SocketEventName.externalUserGroup[this.groupProviderType]
          .GroupSyncFailed,
      );
    } finally {
      await this.setSyncStatus({
        isExecutingSync: false,
        totalCount: 0,
        count: 0,
      });
    }
  }

  /** External user group node sync method
   * 1. Create/Update ExternalUserGroup from using information of ExternalUserGroupTreeNode
   * 2. For every element in node.userInfos, call getMemberUser and create an ExternalUserGroupRelation with ExternalUserGroup if it does not have one
   * 3. Retrun ExternalUserGroup
   * @param {string} node Node of external group tree
   * @param {string} parentId Parent group id (id in GROWI) of the group we want to create/update
   * @returns {Promise<IExternalUserGroupHasId>} ExternalUserGroup that was created/updated
   */
  private async createUpdateExternalUserGroup(
    node: ExternalUserGroupTreeNode,
    parentId?: string,
  ): Promise<IExternalUserGroupHasId> {
    const externalUserGroup =
      await ExternalUserGroup.findAndUpdateOrCreateGroup(
        node.name,
        node.id,
        this.groupProviderType,
        node.description,
        parentId,
      );
    await batchProcessPromiseAll(
      node.userInfos,
      USERS_BATCH_SIZE,
      async (userInfo) => {
        const user = await this.getMemberUser(userInfo);

        if (user != null) {
          const userGroups =
            await ExternalUserGroup.findGroupsWithAncestorsRecursively(
              externalUserGroup,
            );
          const userGroupIds = userGroups.map((g) => g._id);

          // remove existing relations from list to create
          const existingRelations = await ExternalUserGroupRelation.find({
            relatedGroup: { $in: userGroupIds },
            relatedUser: user._id,
          });
          const existingGroupIds = existingRelations.map((r) =>
            r.relatedGroup.toString(),
          );
          const groupIdsToCreateRelation = excludeTestIdsFromTargetIds(
            userGroupIds,
            existingGroupIds,
          );

          await ExternalUserGroupRelation.createRelations(
            groupIdsToCreateRelation,
            user,
          );
        }
      },
    );

    return externalUserGroup;
  }

  /** Method to get group member GROWI user
   * 1. Search for GROWI user based on user info of 1, and return user
   * 2. If autoGenerateUserOnHogeGroupSync is true and GROWI user is not found, create new GROWI user
   * @param {ExternalUserInfo} externalUserInfo Search external app/server using this identifier
   * @returns {Promise<IUserHasId | null>} User when found or created, null when neither
   */
  private async getMemberUser(
    userInfo: ExternalUserInfo,
  ): Promise<IUserHasId | null> {
    const authProviderType = this.authProviderType;
    if (authProviderType == null)
      throw new Error('auth provider type is not set');

    const autoGenerateUserOnGroupSync = configManager.getConfig(
      `external-user-group:${this.groupProviderType}:autoGenerateUserOnGroupSync`,
    );

    const getExternalAccount = async () => {
      if (autoGenerateUserOnGroupSync && externalAccountService != null) {
        return externalAccountService.getOrCreateUser(
          {
            id: userInfo.id,
            username: userInfo.username,
            name: userInfo.name,
            email: userInfo.email,
          },
          authProviderType,
        );
      }
      return ExternalAccount.findOne({
        providerType: this.groupProviderType,
        accountId: userInfo.id,
      });
    };

    const externalAccount = await getExternalAccount();

    if (externalAccount != null) {
      return (
        await externalAccount.populate<{ user: IUserHasId | null }>('user')
      ).user;
    }
    return null;
  }

  getGroupCountOfTree(tree: ExternalUserGroupTreeNode): number {
    if (tree.childGroupNodes.length === 0) return 1;

    let count = 1;
    tree.childGroupNodes.forEach((childGroup) => {
      count += this.getGroupCountOfTree(childGroup);
    });
    return count;
  }

  /** Method to generate external group tree structure
   * 1. Fetch user group info from external app/server
   * 2. Convert each group tree structure to ExternalUserGroupTreeNode
   * 3. Return the root node of each tree
   */
  abstract generateExternalUserGroupTrees(): Promise<
    ExternalUserGroupTreeNode[]
  >;
}

export default ExternalUserGroupSyncService;
