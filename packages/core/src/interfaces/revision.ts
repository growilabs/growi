import type { Ref } from './common.js';
import type { HasObjectId } from './has-object-id.js';
import type { IPage } from './page.js';
import type { IUser } from './user.js';

export const Origin = {
  View: 'view',
  Editor: 'editor',
} as const;

export type Origin = (typeof Origin)[keyof typeof Origin];

export const allOrigin = Object.values(Origin);

export type IRevision = {
  pageId: Ref<IPage>;
  body: string;
  author: Ref<IUser>;
  format: string;
  hasDiffToPrev?: boolean;
  origin?: Origin;
  createdAt: Date;
  updatedAt: Date;
};

export type IRevisionHasId = IRevision & HasObjectId;

export type IRevisionsForPagination = {
  revisions: IRevisionHasId[]; // revisions in one pagination
  totalCounts: number; // total counts
};
export type HasRevisionShortbody = {
  revisionShortBody?: string;
};

export type SWRInfinitePageRevisionsResponse = {
  revisions: IRevisionHasId[];
  totalCount: number;
  offset: number;
};
