import type { IUser, Ref } from '@growi/core';

export type IContribution = {
  user: Ref<IUser>;
  date: Date;
  count: number;
};

export interface IContributionDay {
  date: string;
  count: number;
}

export interface IContributionsResponse {
  contributions: IContributionDay[];
  isMigrationInProgress: boolean;
  isTemporaryUnavailable?: boolean;
}
