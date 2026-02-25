/**
 * global notifcation event master
 */
export const GlobalNotificationSettingEvent = {
  PAGE_CREATE: 'pageCreate',
  PAGE_EDIT: 'pageEdit',
  PAGE_DELETE: 'pageDelete',
  PAGE_MOVE: 'pageMove',
  PAGE_LIKE: 'pageLike',
  COMMENT: 'comment',
} as const;

/**
 * global notifcation type master
 */
export const GlobalNotificationSettingType = {
  MAIL: 'mail',
  SLACK: 'slack',
} as const;
