import type { Types } from 'mongoose';

export interface INewsReadStatus {
  userId: Types.ObjectId;
  newsItemId: Types.ObjectId;
  readAt: Date;
}

export interface INewsReadStatusHasId extends INewsReadStatus {
  _id: Types.ObjectId;
}
