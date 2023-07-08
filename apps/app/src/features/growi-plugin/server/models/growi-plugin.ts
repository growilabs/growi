import { GrowiPluginType } from '@growi/core';
import {
  Schema, type Model, type Document, type Types,
} from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type {
  IGrowiPlugin, IGrowiPluginMeta, IGrowiPluginMetaByType, IGrowiPluginOrigin, IGrowiTemplatePluginMeta, IGrowiThemePluginMeta,
} from '../../interfaces';

export interface IGrowiPluginDocument extends IGrowiPlugin, Document {
}
export interface IGrowiPluginModel extends Model<IGrowiPluginDocument> {
  findEnabledPlugins(): Promise<IGrowiPlugin[]>
  findEnabledPluginsByType<T extends GrowiPluginType>(type: T): Promise<IGrowiPlugin<IGrowiPluginMetaByType<T>>[]>
  activatePlugin(id: Types.ObjectId): Promise<string>
  deactivatePlugin(id: Types.ObjectId): Promise<string>
}

const growiPluginMetaSchema = new Schema<IGrowiPluginMeta & IGrowiThemePluginMeta & IGrowiTemplatePluginMeta>({
  name: { type: String, required: true },
  types: {
    type: [String],
    enum: GrowiPluginType,
    require: true,
  },
  desc: { type: String },
  author: { type: String },
  themes: [Map],
  templateSummaries: [Map],
});

const growiPluginOriginSchema = new Schema<IGrowiPluginOrigin>({
  url: { type: String },
  ghBranch: { type: String },
  ghTag: { type: String },
});

const growiPluginSchema = new Schema<IGrowiPluginDocument, IGrowiPluginModel>({
  isEnabled: { type: Boolean },
  installedPath: { type: String },
  organizationName: { type: String },
  origin: growiPluginOriginSchema,
  meta: growiPluginMetaSchema,
});


growiPluginSchema.statics.findEnabledPlugins = async function(): Promise<IGrowiPlugin[]> {
  return this.find({ isEnabled: true });
};

growiPluginSchema.statics.findEnabledPluginsByType = async function<T extends GrowiPluginType>(
    types: T,
): Promise<IGrowiPlugin<IGrowiPluginMetaByType<T>>[]> {
  return this.find({
    isEnabled: true,
    'meta.types': { $in: types },
  });
};

growiPluginSchema.statics.activatePlugin = async function(id: Types.ObjectId): Promise<string> {
  const growiPlugin = await this.findOneAndUpdate({ _id: id }, { isEnabled: true });
  if (growiPlugin == null) {
    const message = 'No plugin found for this ID.';
    throw new Error(message);
  }
  const pluginName = growiPlugin.meta.name;
  return pluginName;
};

growiPluginSchema.statics.deactivatePlugin = async function(id: Types.ObjectId): Promise<string> {
  const growiPlugin = await this.findOneAndUpdate({ _id: id }, { isEnabled: false });
  if (growiPlugin == null) {
    const message = 'No plugin found for this ID.';
    throw new Error(message);
  }
  const pluginName = growiPlugin.meta.name;
  return pluginName;
};

export const GrowiPlugin = getOrCreateModel<IGrowiPluginDocument, IGrowiPluginModel>('GrowiPlugin', growiPluginSchema);
