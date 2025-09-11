import type { IPageHasId, ITag } from '@growi/core';

export type IDataTagCount = ITag & { count: number };

export type IPageTagsInfo = {
  tags: string[];
};

export type IListTagNamesByPage = string[];

export type IResTagsUpdateApiv1 = {
  ok: boolean;
  savedPage: IPageHasId;
  tags: string[];
};

export type IResTagsSearchApiv1 = {
  ok: boolean;
  tags: string[];
};

export type IResGetPageTags = {
  ok: boolean;
  tags: string[];
};

export type IResTagsListApiv1 = {
  ok: boolean;
  data: IDataTagCount[];
  totalCount: number;
};
