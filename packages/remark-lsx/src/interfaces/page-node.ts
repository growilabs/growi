import type { IPageHasId } from '@growi/core';

export type PageNode = {
  pagePath: string;
  children: PageNode[];
  page?: IPageHasId;
};
