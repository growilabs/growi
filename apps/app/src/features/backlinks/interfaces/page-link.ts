import type { Document, Model, Types } from 'mongoose';

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
  // Declare each static here only when the schema actually implements it: a
  // declaration without an implementation makes `PageLink.thatStatic()`
  // type-check and then throw "is not a function" at runtime. The re-resolve-by-path
  // (B4) and reconcile-deleted (B5) statics are added alongside their code.
}
