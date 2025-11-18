import type { IPage, ITag } from '@growi/core';

export type IPageTagRelation = {
  relatedPage: IPage;
  relatedTag: ITag;
  isPageTrashed: boolean;
};
