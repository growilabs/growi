import type { Document, Model, Types } from 'mongoose';

export type LinkTargetState = 'normal' | 'trashed' | 'broken';

export interface IBacklink {
  pageId: string;
  path: string;
}

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
  // Declared here for downstream stories; implemented later (re-resolve-by-path in B4,
  // reconcile-deleted in B5) — not implemented in B1.
  reResolveByToPath(toPath: string): Promise<void>;
  reconcileDeletedPages(pageIds: Types.ObjectId[]): Promise<void>;
}
