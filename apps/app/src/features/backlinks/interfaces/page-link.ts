import type { Document, ObjectId } from 'mongodb';
import type { Model } from 'mongoose';

export interface PageLink {
  fromPage: ObjectId;
  toPath: string;
  toPage: ObjectId | null;
}

export interface PageLinkDocument extends PageLink, Document {}
export interface PageLinkModel extends Model<PageLinkDocument> {}
