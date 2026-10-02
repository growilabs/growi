import type { HasObjectId, IPageHasId } from '@growi/core';

// Todo: specify more detailed Type
export type IResShareLinkList = {
  shareLinksResult: any[];
};

export type IShareLink = {
  relatedPage: IPageHasId;
  createdAt: Date;
  expiredAt?: Date;
  description: string;
};

export type IShareLinkHasId = IShareLink & HasObjectId;
