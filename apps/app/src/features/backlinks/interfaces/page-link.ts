import type { Types } from 'mongoose';

export interface IPageLink {
  fromPage: Types.ObjectId;
  toPath: string;
  toPage: Types.ObjectId | null;
}
