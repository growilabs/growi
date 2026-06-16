import type { IUser, Ref } from '@growi/core';
import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { SidebarContentsType } from '~/interfaces/ui';
import type { IUserUISettings } from '~/interfaces/user-ui-settings';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface UserUISettingsDocument extends IUserUISettings, Document {
  user: Ref<IUser>;
}
export type UserUISettingsModel = Model<UserUISettingsDocument>;

const schema = new Schema<UserUISettingsDocument, UserUISettingsModel>({
  user: { type: Schema.Types.ObjectId, ref: 'User', unique: true },
  currentSidebarContents: {
    type: String,
    enum: SidebarContentsType,
    default: SidebarContentsType.RECENT,
  },
  currentProductNavWidth: { type: Number },
  preferCollapsedModeByUser: { type: Boolean, default: false },
});

export default getOrCreateModel<UserUISettingsDocument, UserUISettingsModel>(
  'UserUISettings',
  schema,
);
