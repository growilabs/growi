import type { Scope } from '@growi/core/dist/interfaces';

export type IAccessTokenInfo = {
  expiredAt: Date;
  description: string;
  // biome-ignore lint/suspicious/noTsIgnore: Suppress auto fix by lefthook
  // @ts-ignore - Scope type causes "Type instantiation is excessively deep" with tsgo
  scopes: Scope[];
};

export type IResGenerateAccessToken = IAccessTokenInfo & {
  token: string;
  _id: string;
};

export type IResGetAccessToken = IAccessTokenInfo & {
  _id: string;
};
