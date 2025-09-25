import type { IPageHasId } from '@growi/core';

export type LsxApiOptions = {
  depth?: string;
  filter?: string;
  except?: string;
  sort?: string;
  reverse?: string;
};

export type LsxApiParams = {
  pagePath: string;
  offset?: number;
  limit?: number;
  options?: LsxApiOptions;
};

export type LsxApiResponseData = {
  pages: IPageHasId[];
  cursor: number;
  total: number;
  toppageViewersCount: number;
};
