import type { Document, ObjectId } from 'mongodb';
import type { Model } from 'mongoose';

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
  fromPage: ObjectId;
  toPath: string;
  toPage: ObjectId | null;
}

export interface PageLinkDocument extends IPageLink, Document {}
export interface PageLinkModel extends Model<PageLinkDocument> {}
