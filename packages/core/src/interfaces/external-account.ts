import type { Ref } from './common';
import type { IUser } from './user';

export type IExternalAccount<P> = {
  providerType: P;
  accountId: string;
  user: Ref<IUser>;
};
