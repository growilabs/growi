/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IUpdatePost {
  pathPattern: string;
  patternPrefix: string;
  patternPrefix2: string;
  channel: string;
  provider: string;
  creator: Types.ObjectId;
  createdAt: Date;
}

export interface UpdatePostDocument extends IUpdatePost, Document {}

export interface UpdatePostModel extends Model<UpdatePostDocument> {
  normalizeChannelName(channel): any;
  createPrefixesByPathPattern(pathPattern): any;
  getRegExpByPattern(pattern): any;
  findSettingsByPath(path): Promise<UpdatePostDocument[]>;
  findAll(offset?: number): Promise<UpdatePostDocument[]>;
  createUpdatePost(
    pathPattern: string,
    channel: string,
    creator: Types.ObjectId,
  ): Promise<UpdatePostDocument>;
}

/**
 * This is the setting for notify to 3rd party tool (like Slack).
 */
const updatePostSchema = new Schema<UpdatePostDocument, UpdatePostModel>(
  {
    pathPattern: { type: String, required: true },
    patternPrefix: { type: String, required: true },
    patternPrefix2: { type: String, required: true },
    channel: { type: String, required: true },
    provider: { type: String, required: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  {
    timestamps: true,
  },
);

updatePostSchema.statics.normalizeChannelName = (channel) =>
  channel.replace(/(#|,)/g, '');

updatePostSchema.statics.createPrefixesByPathPattern = (pathPattern) => {
  const patternPrefix = ['*', '*'];

  // not begin with slash
  if (!pathPattern.match(/^\/.+/)) {
    return patternPrefix;
  }

  const pattern = pathPattern.split('/');
  pattern.shift();
  if (pattern[0] && pattern[0] !== '*') {
    patternPrefix[0] = pattern[0];
  }

  if (pattern[1] && pattern[1] !== '*') {
    patternPrefix[1] = pattern[1];
  }
  return patternPrefix;
};

updatePostSchema.statics.getRegExpByPattern = (pattern) => {
  let reg = pattern;
  if (!reg.match(/^\/.*/)) {
    reg = `/*${reg}*`;
  }
  reg = `^${reg}`;
  reg = reg.replace(/\//g, '\\/');
  reg = reg.replace(/(\*)/g, '.*');

  return new RegExp(reg);
};

updatePostSchema.statics.findSettingsByPath = async function (path) {
  const prefixes = this.createPrefixesByPathPattern(path);

  const settings = await this.find({
    $or: [
      { patternPrefix: prefixes[0], patternPrefix2: prefixes[1] },
      { patternPrefix: '*', patternPrefix2: '*' },
      { patternPrefix: prefixes[0], patternPrefix2: '*' },
      { patternPrefix: '*', patternPrefix2: prefixes[1] },
    ],
  });
  if (settings.length <= 0) {
    return settings;
  }

  const validSettings = settings.filter((setting) => {
    const patternRegex = this.getRegExpByPattern(setting.pathPattern);
    return patternRegex.test(path);
  });

  return validSettings;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
updatePostSchema.statics.findAll = function (offset = 0) {
  return this.find().sort({ createdAt: 1 }).populate('creator').exec();
};

updatePostSchema.statics.createUpdatePost = async function (
  pathPattern,
  channel,
  creator,
) {
  const provider = 'slack'; // now slack only

  const prefixes = this.createPrefixesByPathPattern(pathPattern);

  return this.create({
    pathPattern,
    patternPrefix: prefixes[0],
    patternPrefix2: prefixes[1],
    channel: this.normalizeChannelName(channel),
    provider,
    creator,
  });
};

export default getOrCreateModel<UpdatePostDocument, UpdatePostModel>(
  'UpdatePost',
  updatePostSchema,
);
