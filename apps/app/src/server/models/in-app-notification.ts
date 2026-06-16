import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import {
  AllSupportedActions,
  AllSupportedTargetModels,
} from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';

import { getOrCreateModel } from '../util/mongoose-utils';
import type { ActivityDocument } from './activity';

const { STATUS_UNOPENED, STATUS_OPENED } = InAppNotificationStatuses;

export interface InAppNotificationDocument extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  targetModel: string;
  target: Types.ObjectId;
  action: string;
  activities: ActivityDocument[];
  status: string;
  createdAt: Date;
  snapshot: string;
}

export interface InAppNotificationModel
  extends Model<InAppNotificationDocument> {
  findLatestInAppNotificationsByUser(
    user: Types.ObjectId,
    skip: number,
    offset: number,
  );
  getUnreadCountByUser(user: Types.ObjectId): Promise<number | undefined>;
  open(user, id: Types.ObjectId): Promise<InAppNotificationDocument | null>;
  read(user) /* : Promise<Query<any>> */;

  STATUS_UNOPENED: string;
  STATUS_OPENED: string;
}

const inAppNotificationSchema = new Schema<
  InAppNotificationDocument,
  InAppNotificationModel
>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    targetModel: {
      type: String,
      required: true,
      enum: AllSupportedTargetModels,
    },
    target: {
      type: Schema.Types.ObjectId,
      refPath: 'targetModel',
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: AllSupportedActions,
    },
    activities: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Activity',
      },
    ],
    status: {
      type: String,
      default: STATUS_UNOPENED,
      enum: InAppNotificationStatuses,
      index: true,
      required: true,
    },
    snapshot: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
// indexes
inAppNotificationSchema.index({ createdAt: 1 });
// apply plugins
inAppNotificationSchema.plugin(mongoosePaginate);

const transform = (doc, ret) => {
  delete ret.activities;
};
inAppNotificationSchema.set('toObject', { virtuals: true, transform });
inAppNotificationSchema.set('toJSON', { virtuals: true, transform });
inAppNotificationSchema.index({
  user: 1,
  target: 1,
  action: 1,
  createdAt: 1,
});

inAppNotificationSchema.statics.STATUS_UNOPENED = () => STATUS_UNOPENED;
inAppNotificationSchema.statics.STATUS_OPENED = () => STATUS_OPENED;

const InAppNotification = getOrCreateModel<
  InAppNotificationDocument,
  InAppNotificationModel
>('InAppNotification', inAppNotificationSchema);

export { InAppNotification };
