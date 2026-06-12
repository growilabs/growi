import type { NotifyType } from './global-notification.js';

export type INotificationType = {
  __t?: NotifyType;
  _id: string;
  // TOOD: Define the provider type
  provider?: any;
};
