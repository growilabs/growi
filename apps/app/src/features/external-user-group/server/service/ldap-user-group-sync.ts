import { configManager } from '~/server/service/config-manager';
import type { SearchResultEntry } from '~/server/service/ldap';
import { ldapService } from '~/server/service/ldap';
import type PassportService from '~/server/service/passport';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';
import loggerFactory from '~/utils/logger';
import { batchProcessPromiseAll } from '~/utils/promise';

import type {
  ExternalUserGroupTreeNode,
  ExternalUserInfo,
} from '../../interfaces/external-user-group';
import {
  ExternalGroupProviderType,
  LdapGroupMembershipAttributeType,
} from '../../interfaces/external-user-group';

import ExternalUserGroupSyncService from './external-user-group-sync';

const logger = loggerFactory('growi:service:ldap-user-group-sync-service');

// When d = max depth of group trees
// Max space complexity of generateExternalUserGroupTrees will be:
// O(TREES_BATCH_SIZE * d * USERS_BATCH_SIZE)
const TREES_BATCH_SIZE = 10;
const USERS_BATCH_SIZE = 30;

export class LdapUserGroupSyncService extends ExternalUserGroupSyncService {
  passportService: PassportService;

  isInitialized = false;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(
    passportService: PassportService,
    s2sMessagingService: S2sMessagingService,
    socketIoService,
  ) {
    super(ExternalGroupProviderType.ldap, s2sMessagingService, socketIoService);
    this.authProviderType = 'ldap';
    this.passportService = passportService;
  }

  async init(
    userBindUsername?: string,
    userBindPassword?: string,
  ): Promise<void> {
    await ldapService.initClient(userBindUsername, userBindPassword);
    this.isInitialized = true;
  }

  override syncExternalUserGroups(): Promise<void> {
    if (!this.isInitialized) {
      const msg = 'Service not initialized';
      logger.error(msg);
      throw new Error(msg);
    }
    return super.syncExternalUserGroups();
  }

  override async generateExternalUserGroupTrees(): Promise<
    ExternalUserGroupTreeNode[]
  > {
    const groupChildGroupAttribute = configManager.getConfig(
      'external-user-group:ldap:groupChildGroupAttribute',
    );
    const groupMembershipAttribute = configManager.getConfig(
      'external-user-group:ldap:groupMembershipAttribute',
    );
    const groupNameAttribute = configManager.getConfig(
      'external-user-group:ldap:groupNameAttribute',
    );
    const groupDescriptionAttribute = configManager.getConfig(
      'external-user-group:ldap:groupDescriptionAttribute',
    );
    const groupBase = ldapService.getGroupSearchBase();

    const groupEntries = await ldapService.searchGroupDir();

    const getChildGroupDnsFromGroupEntry = (groupEntry: SearchResultEntry) => {
      // groupChildGroupAttribute and groupMembershipAttribute may be the same,
      // so filter values of groupChildGroupAttribute to ones that include groupBase
      return ldapService
        .getArrayValFromSearchResultEntry(groupEntry, groupChildGroupAttribute)
        .filter((attr) => attr.includes(groupBase));
    };
    const getUserIdsFromGroupEntry = (groupEntry: SearchResultEntry) => {
      // groupChildGroupAttribute and groupMembershipAttribute may be the same,
      // so filter values of groupMembershipAttribute to ones that does not include groupBase
      return ldapService
        .getArrayValFromSearchResultEntry(groupEntry, groupMembershipAttribute)
        .filter((attr) => !attr.includes(groupBase));
    };

    const convert = async (
      entry: SearchResultEntry,
      converted: string[],
    ): Promise<ExternalUserGroupTreeNode | null> => {
      const name = ldapService.getStringValFromSearchResultEntry(
        entry,
        groupNameAttribute,
      );
      if (name == null) return null;

      if (converted.includes(entry.objectName)) {
        throw Error('Circular reference inside LDAP group tree');
      }
      converted.push(entry.objectName);

      const userIds = getUserIdsFromGroupEntry(entry);

      const userInfos = (
        await batchProcessPromiseAll(userIds, USERS_BATCH_SIZE, (id) => {
          return this.getUserInfo(id);
        })
      ).filter((info): info is NonNullable<ExternalUserInfo> => info != null);
      const description = ldapService.getStringValFromSearchResultEntry(
        entry,
        groupDescriptionAttribute,
      );
      const childGroupDNs = getChildGroupDnsFromGroupEntry(entry);

      const childGroupNodesWithNull: (ExternalUserGroupTreeNode | null)[] = [];
      // Do not use Promise.all, because the number of promises processed can
      // exponentially grow when group tree is enormous
      for await (const dn of childGroupDNs) {
        const childEntry = groupEntries.find((ge) => ge.objectName === dn);
        childGroupNodesWithNull.push(
          childEntry != null ? await convert(childEntry, converted) : null,
        );
      }
      const childGroupNodes: ExternalUserGroupTreeNode[] =
        childGroupNodesWithNull.filter(
          (node): node is NonNullable<ExternalUserGroupTreeNode> =>
            node != null,
        );

      return {
        id: entry.objectName,
        userInfos,
        childGroupNodes,
        name,
        description,
      };
    };

    // all the DNs of groups that are not a root of a tree
    const allChildGroupDNs = new Set(
      groupEntries.flatMap((entry) => {
        return getChildGroupDnsFromGroupEntry(entry);
      }),
    );

    // root of every tree
    const rootEntries = groupEntries.filter((entry) => {
      return !allChildGroupDNs.has(entry.objectName);
    });

    return (
      await batchProcessPromiseAll(rootEntries, TREES_BATCH_SIZE, (entry) =>
        convert(entry, []),
      )
    ).filter(
      (node): node is NonNullable<ExternalUserGroupTreeNode> => node != null,
    );
  }

  private async getUserInfo(userId: string): Promise<ExternalUserInfo | null> {
    const groupMembershipAttributeType = configManager.getConfig(
      'external-user-group:ldap:groupMembershipAttributeType',
    );
    const attrMapUsername =
      this.passportService.getLdapAttrNameMappedToUsername();
    const attrMapName = this.passportService.getLdapAttrNameMappedToName();
    const attrMapMail = this.passportService.getLdapAttrNameMappedToMail();

    // get full user info from LDAP server using externalUserInfo (DN or UID)
    const getUserEntries = async () => {
      if (
        groupMembershipAttributeType === LdapGroupMembershipAttributeType.dn
      ) {
        return ldapService.search(undefined, userId, 'base');
      }
      if (
        groupMembershipAttributeType === LdapGroupMembershipAttributeType.uid
      ) {
        return ldapService.search(`(uid=${userId})`, undefined);
      }
    };

    const userEntries = await getUserEntries();

    if (userEntries != null && userEntries.length > 0) {
      const userEntry = userEntries[0];
      const uid = ldapService.getStringValFromSearchResultEntry(
        userEntry,
        'uid',
      );
      if (uid != null) {
        const usernameToBeRegistered =
          attrMapUsername === 'uid'
            ? uid
            : ldapService.getStringValFromSearchResultEntry(
                userEntry,
                attrMapUsername,
              );
        const nameToBeRegistered =
          ldapService.getStringValFromSearchResultEntry(userEntry, attrMapName);
        const mailToBeRegistered =
          ldapService.getStringValFromSearchResultEntry(userEntry, attrMapMail);

        return usernameToBeRegistered != null
          ? {
              id: uid,
              username: usernameToBeRegistered,
              name: nameToBeRegistered,
              email: mailToBeRegistered,
            }
          : null;
      }
    }
    return null;
  }
}
