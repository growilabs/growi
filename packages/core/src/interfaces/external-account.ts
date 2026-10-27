import type { Ref } from './common.js';
import type { IUser } from './user.js';

export type IExternalAccount<P> = {
  providerType: P;
  accountId: string;
  user: Ref<IUser>;
};
