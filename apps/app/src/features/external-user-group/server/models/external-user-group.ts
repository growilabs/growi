import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import type { IExternalUserGroup } from '~/features/external-user-group/interfaces/external-user-group';
import UserGroup from '~/server/models/user-group';
import { getOrCreateModel } from '~/server/util/mongoose-utils';

export interface ExternalUserGroupDocument
  extends IExternalUserGroup,
    Document {}

export interface ExternalUserGroupModel
  extends Model<ExternalUserGroupDocument> {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  [x: string]: any; // for old methods

  PAGE_ITEMS: 10;

  findGroupsWithDescendantsRecursively: (
    groups: ExternalUserGroupDocument[],
    descendants?: ExternalUserGroupDocument[],
  ) => Promise<ExternalUserGroupDocument[]>;
}

const schema = new Schema<ExternalUserGroupDocument, ExternalUserGroupModel>(
  {
    name: { type: String, required: true },
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'ExternalUserGroup',
      index: true,
    },
    description: { type: String, default: '' },
    externalId: { type: String, required: true, unique: true },
    provider: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);
schema.plugin(mongoosePaginate);
// group name should be unique for each provider
schema.index({ name: 1, provider: 1 }, { unique: true });

/**
 * Find group that has specified externalId and update, or create one if it doesn't exist.
 * @param name ExternalUserGroup name
 * @param name ExternalUserGroup externalId
 * @param name ExternalUserGroup provider
 * @param name ExternalUserGroup description
 * @param name ExternalUserGroup parentId
 * @returns ExternalUserGroupDocument[]
 */
schema.statics.findAndUpdateOrCreateGroup = async function (
  name: string,
  externalId: string,
  provider: string,
  description?: string,
  parentId?: string,
) {
  let parent: ExternalUserGroupDocument | null = null;
  if (parentId != null) {
    parent = await this.findOne({ _id: parentId });
    if (parent == null) {
      throw Error('Parent does not exist.');
    }
  }

  return this.findOneAndUpdate(
    { externalId },
    {
      name,
      description,
      provider,
      parent,
    },
    { upsert: true, new: true },
  );
};

schema.statics.findWithPagination = UserGroup.findWithPagination;

schema.statics.findChildrenByParentIds = UserGroup.findChildrenByParentIds;

schema.statics.findGroupsWithAncestorsRecursively =
  UserGroup.findGroupsWithAncestorsRecursively;

schema.statics.findGroupsWithDescendantsRecursively =
  UserGroup.findGroupsWithDescendantsRecursively;

schema.statics.findGroupsWithDescendantsById =
  UserGroup.findGroupsWithDescendantsById;

export default getOrCreateModel<
  ExternalUserGroupDocument,
  ExternalUserGroupModel
>('ExternalUserGroup', schema);
