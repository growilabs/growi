import type {
  HasObjectId,
  IUserGroup,
  IUserGroupRelation,
  Ref,
} from '@growi/core';

export const ExternalGroupProviderType = {
  ldap: 'ldap',
  keycloak: 'keycloak',
} as const;
export type ExternalGroupProviderType =
  (typeof ExternalGroupProviderType)[keyof typeof ExternalGroupProviderType];

export interface IExternalUserGroup extends Omit<IUserGroup, 'parent'> {
  parent: Ref<IExternalUserGroup> | null;
  externalId: string; // identifier used in external app/server
  provider: ExternalGroupProviderType;
}

export type IExternalUserGroupHasId = IExternalUserGroup & HasObjectId;

export interface IExternalUserGroupRelation
  extends Omit<IUserGroupRelation, 'relatedGroup'> {
  relatedGroup: Ref<IExternalUserGroup>;
}

export type IExternalUserGroupRelationHasId = IExternalUserGroupRelation &
  HasObjectId;

export const LdapGroupMembershipAttributeType = {
  dn: 'DN',
  uid: 'UID',
} as const;
type LdapGroupMembershipAttributeType =
  (typeof LdapGroupMembershipAttributeType)[keyof typeof LdapGroupMembershipAttributeType];

export interface LdapGroupSyncSettings {
  ldapGroupSearchBase: string;
  ldapGroupMembershipAttribute: string;
  ldapGroupMembershipAttributeType: LdapGroupMembershipAttributeType;
  ldapGroupChildGroupAttribute: string;
  autoGenerateUserOnLdapGroupSync: boolean;
  preserveDeletedLdapGroups: boolean;
  ldapGroupNameAttribute: string;
  ldapGroupDescriptionAttribute?: string;
}

export interface KeycloakGroupSyncSettings {
  keycloakHost: string;
  keycloakGroupRealm: string;
  keycloakGroupSyncClientRealm: string;
  keycloakGroupSyncClientID: string;
  keycloakGroupSyncClientSecret: string;
  autoGenerateUserOnKeycloakGroupSync: boolean;
  preserveDeletedKeycloakGroups: boolean;
  keycloakGroupDescriptionAttribute?: string;
}

export type ExternalUserInfo = {
  id: string; // external user id
  username: string;
  name?: string;
  email?: string;
};

// Data structure to express the tree structure of external groups, before converting to ExternalUserGroup model
export interface ExternalUserGroupTreeNode {
  id: string; // external group id
  userInfos: ExternalUserInfo[];
  childGroupNodes: ExternalUserGroupTreeNode[];
  name: string;
  description?: string;
}
