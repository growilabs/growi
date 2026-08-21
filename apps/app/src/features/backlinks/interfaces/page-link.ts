import type { Document, Model, Types } from 'mongoose';

export type LinkTargetState = 'normal' | 'trashed' | 'broken';

export interface ILinkTarget {
  pageId: string;
  path: string;
  targetState: LinkTargetState;
}

export interface IPageLink {
  fromPage: Types.ObjectId;
  toPath: string;
  toPage: Types.ObjectId | null;
}

export interface PageLinkDocument extends IPageLink, Document {}
export interface PageLinkModel extends Model<PageLinkDocument> {
  replaceOutboundLinks(
    fromPageId: Types.ObjectId,
    resolvedRows: IPageLink[],
  ): Promise<void>;
  findBacklinkSources(toPageId: Types.ObjectId): Promise<Types.ObjectId[]>;
  repointInboundLinks(
    toPath: string,
    toPage: Types.ObjectId | null,
  ): Promise<void>;
  // Declared here for a downstream story; implemented later (reconcile-deleted in B5).
  reconcileDeletedPages(pageIds: Types.ObjectId[]): Promise<void>;
}
