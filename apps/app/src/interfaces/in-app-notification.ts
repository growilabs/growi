import type { HasObjectId, IUser } from '@growi/core';

import type { SupportedActionType, SupportedTargetModelType } from './activity';

export const InAppNotificationStatuses = {
  STATUS_UNOPENED: 'UNOPENED',
  STATUS_OPENED: 'OPENED',
} as const;
export type InAppNotificationStatuses =
  (typeof InAppNotificationStatuses)[keyof typeof InAppNotificationStatuses];

export interface IInAppNotification<T = unknown> {
  user: IUser;
  targetModel: SupportedTargetModelType;
  target: T;
  action: SupportedActionType;
  status: InAppNotificationStatuses;
  actionUsers: IUser[];
  createdAt: Date;
  snapshot: string;
  parsedSnapshot?: any;
}

export type IInAppNotificationHasId<T = unknown> = IInAppNotification<T> &
  HasObjectId;

/*
 * Note:
 * Need to use mongoose PaginateResult as a type after upgrading mongoose v6.0.0.
 * Until then, use the original "PaginateResult".
 */
export interface PaginateResult<T> {
  docs: T[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number | null;
  offset: number;
  page: number;
  pagingCounter: number;
  prevPage: number | null;
  totalDocs: number;
  totalPages: number;
}

/*
 * In App Notification Settings
 */

export const subscribeRuleNames = {
  PAGE_CREATE: 'PAGE_CREATE',
} as const;
export type subscribeRuleNames =
  (typeof subscribeRuleNames)[keyof typeof subscribeRuleNames];

export const SubscribeRuleDescriptions = {
  PAGE_CREATE:
    'in_app_notification_settings.default_subscribe_rules.page_create',
} as const;
export type SubscribeRuleDescriptions =
  (typeof SubscribeRuleDescriptions)[keyof typeof SubscribeRuleDescriptions];

export interface ISubscribeRule {
  name: subscribeRuleNames;
  isEnabled: boolean;
}
export interface IInAppNotificationSettings<UserID> {
  userId: UserID | string;
  subscribeRules: ISubscribeRule[];
}
