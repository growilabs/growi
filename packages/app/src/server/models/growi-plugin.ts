import { GrowiThemeMetadata, GrowiThemeSchemeType } from '@growi/core';
import {
  Schema, Model, Document,
} from 'mongoose';

import {
  GrowiPlugin, GrowiPluginMeta, GrowiPluginOrigin, GrowiPluginResourceType, GrowiThemePluginMeta,
} from '~/interfaces/plugin';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface GrowiPluginDocument extends GrowiPlugin, Document {
}
export interface GrowiPluginModel extends Model<GrowiPluginDocument> {
  findEnabledPlugins(): Promise<GrowiPlugin[]>
  findEnabledPluginsIncludingAnyTypes(includingTypes: GrowiPluginResourceType[]): Promise<GrowiPlugin[]>
}

const growiThemeMetadataSchema = new Schema<GrowiThemeMetadata>({
  name: { type: String, required: true },
  manifestKey: { type: String, required: true },
  schemeType: {
    type: String,
    enum: GrowiThemeSchemeType,
    require: true,
  },
  bg: { type: String, required: true },
  topbar: { type: String, required: true },
  sidebar: { type: String, required: true },
  accent: { type: String, required: true },
});

const growiPluginMetaSchema = new Schema<GrowiPluginMeta|GrowiThemePluginMeta>({
  name: { type: String, required: true },
  types: {
    type: [String],
    enum: GrowiPluginResourceType,
    require: true,
  },
  desc: { type: String },
  author: { type: String },
  themes: [growiThemeMetadataSchema],
});

const growiPluginOriginSchema = new Schema<GrowiPluginOrigin>({
  url: { type: String },
  ghBranch: { type: String },
  ghTag: { type: String },
});

const growiPluginSchema = new Schema<GrowiPluginDocument, GrowiPluginModel>({
  isEnabled: { type: Boolean },
  installedPath: { type: String },
  origin: growiPluginOriginSchema,
  meta: growiPluginMetaSchema,
});

growiPluginSchema.statics.findEnabledPlugins = async function(): Promise<GrowiPlugin[]> {
  return this.find({ isEnabled: true });
};
growiPluginSchema.statics.findEnabledPluginsIncludingAnyTypes = async function(types: GrowiPluginResourceType[]): Promise<GrowiPlugin[]> {
  return this.find({
    isEnabled: true,
    'meta.types': { $in: types },
  });
};

export default getOrCreateModel<GrowiPluginDocument, GrowiPluginModel>('GrowiPlugin', growiPluginSchema);
