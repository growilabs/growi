import { GroupType, type IGrantedGroup } from '@growi/core';
import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import {
  type AiAssistant,
  AiAssistantAccessScope,
  AiAssistantShareScope,
} from '../../interfaces/ai-assistant';

export interface AiAssistantDocument extends AiAssistant, Document {}

interface AiAssistantModel extends Model<AiAssistantDocument> {
  setDefault(id: string, isDefault: boolean): Promise<AiAssistantDocument>;
}

/*
 * Schema Definition
 */
const schema = new Schema<AiAssistantDocument>(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
      default: '',
    },
    additionalInstruction: {
      type: String,
      required: true,
      default: '',
    },
    pagePathPatterns: [
      {
        type: String,
        required: true,
      },
    ],
    vectorStore: {
      type: Schema.Types.ObjectId,
      ref: 'VectorStore',
      required: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    grantedGroupsForShareScope: {
      type: [
        {
          type: {
            type: String,
            enum: Object.values(GroupType),
            required: true,
            default: 'UserGroup',
          },
          item: {
            type: Schema.Types.ObjectId,
            refPath: 'grantedGroupsForShareScope.type',
            required: true,
            index: true,
          },
        },
      ],
      validate: [
        (arr: IGrantedGroup[]): boolean => {
          if (arr == null) return true;
          const uniqueItemValues = new Set(arr.map((e) => e.item));
          return arr.length === uniqueItemValues.size;
        },
        'grantedGroups contains non unique item',
      ],
      default: [],
    },
    grantedGroupsForAccessScope: {
      type: [
        {
          type: {
            type: String,
            enum: Object.values(GroupType),
            required: true,
            default: 'UserGroup',
          },
          item: {
            type: Schema.Types.ObjectId,
            refPath: 'grantedGroupsForAccessScope.type',
            required: true,
            index: true,
          },
        },
      ],
      validate: [
        (arr: IGrantedGroup[]): boolean => {
          if (arr == null) return true;
          const uniqueItemValues = new Set(arr.map((e) => e.item));
          return arr.length === uniqueItemValues.size;
        },
        'grantedGroups contains non unique item',
      ],
      default: [],
    },
    shareScope: {
      type: String,
      enum: Object.values(AiAssistantShareScope),
      required: true,
    },
    accessScope: {
      type: String,
      enum: Object.values(AiAssistantAccessScope),
      required: true,
    },
    isDefault: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

schema.statics.setDefault = async function (
  id: string,
  isDefault: boolean,
): Promise<AiAssistantDocument> {
  if (isDefault) {
    await this.bulkWrite([
      {
        updateOne: {
          filter: {
            _id: id,
            shareScope: AiAssistantShareScope.PUBLIC_ONLY,
          },
          update: { $set: { isDefault: true } },
        },
      },
      {
        updateMany: {
          filter: {
            _id: { $ne: id },
            isDefault: true,
          },
          update: { $set: { isDefault: false } },
        },
      },
    ]);
  } else {
    await this.findByIdAndUpdate(id, { isDefault: false });
  }

  const updatedAiAssistant = await this.findById(id);
  return updatedAiAssistant;
};

export default getOrCreateModel<AiAssistantDocument, AiAssistantModel>(
  'AiAssistant',
  schema,
);
