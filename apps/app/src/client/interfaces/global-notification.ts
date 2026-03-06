export const NotifyType = {
  Email: 'mail',
  SLACK: 'slack',
} as const;

export type NotifyType = (typeof NotifyType)[keyof typeof NotifyType];

export const TriggerEventType = {
  CREATE: 'pageCreate',
  EDIT: 'pageEdit',
  MOVE: 'pageMove',
  DELETE: 'pageDelete',
  LIKE: 'pageLike',
  POST: 'comment',
} as const;

type TriggerEventType =
  (typeof TriggerEventType)[keyof typeof TriggerEventType];

export type IGlobalNotification = {
  triggerPath: string;
  notifyType: NotifyType;
  emailToSend: string;
  slackChannelToSend: string;
  triggerEvents: TriggerEventType[];
};
