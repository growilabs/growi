import type { IUser, Ref } from '@growi/core';

export type IContribution = {
  user: Ref<IUser>;
  date: Date;
  count: number;
};
