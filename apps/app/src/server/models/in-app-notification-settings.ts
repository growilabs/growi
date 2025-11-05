import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import type { IInAppNotificationSettings } from '~/interfaces/in-app-notification';
import { subscribeRuleNames } from '~/interfaces/in-app-notification';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface InAppNotificationSettingsDocument
  extends IInAppNotificationSettings<Types.ObjectId>,
    Document {}
export type InAppNotificationSettingsModel =
  Model<InAppNotificationSettingsDocument>;

const inAppNotificationSettingsSchema = new Schema<
  InAppNotificationSettingsDocument,
  InAppNotificationSettingsModel
>({
  userId: { type: Schema.Types.ObjectId },
  subscribeRules: [
    {
      name: { type: String, required: true, enum: subscribeRuleNames },
      isEnabled: { type: Boolean },
    },
  ],
});

// eslint-disable-next-line max-len
export default getOrCreateModel<
  InAppNotificationSettingsDocument,
  InAppNotificationSettingsModel
>('InAppNotificationSettings', inAppNotificationSettingsSchema);
