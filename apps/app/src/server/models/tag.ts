import type { Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import { getOrCreateModel } from '../util/mongoose-utils';

const mongoosePaginate = require('mongoose-paginate-v2');
const uniqueValidator = require('mongoose-unique-validator');

export interface TagDocument {
  _id: Types.ObjectId;
  name: string;
}

export type IdToNameMap = { [key: string]: string };
export type IdToNamesMap = { [key: string]: string[] };

export interface TagModel extends Model<TagDocument> {
  getIdToNameMap(tagIds: ObjectIdLike[]): IdToNameMap;
  findOrCreateMany(tagNames: string[]): Promise<TagDocument[]>;
}

const tagSchema = new Schema<TagDocument, TagModel>({
  name: {
    type: String,
    require: true,
    unique: true,
  },
});
tagSchema.plugin(mongoosePaginate);
tagSchema.plugin(uniqueValidator);

tagSchema.statics.getIdToNameMap = async function (
  tagIds: ObjectIdLike[],
): Promise<IdToNameMap> {
  const tags = await this.find({ _id: { $in: tagIds } });

  const idToNameMap = {};
  tags.forEach((tag) => {
    idToNameMap[tag._id.toString()] = tag.name;
  });

  return idToNameMap;
};

tagSchema.statics.findOrCreateMany = async function (
  tagNames: string[],
): Promise<TagDocument[]> {
  const existTags = await this.find({ name: { $in: tagNames } });
  const existTagNames = existTags.map((tag) => {
    return tag.name;
  });

  // bulk insert
  const tagsToCreate = tagNames.filter((tagName) => {
    return !existTagNames.includes(tagName);
  });
  await this.insertMany(
    tagsToCreate.map((tag) => {
      return { name: tag };
    }),
  );

  return this.find({ name: { $in: tagNames } });
};

export default getOrCreateModel<TagDocument, TagModel>('Tag', tagSchema);
