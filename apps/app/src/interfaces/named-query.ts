import type { IUser } from '@growi/core';

export const SearchDelegatorName = {
  DEFAULT: 'FullTextSearch',
  PRIVATE_LEGACY_PAGES: 'PrivateLegacyPages',
} as const;
export type SearchDelegatorName =
  (typeof SearchDelegatorName)[keyof typeof SearchDelegatorName];
export interface INamedQuery {
  name: string;
  aliasOf?: string;
  delegatorName?: SearchDelegatorName;
  creator?: IUser;
}
