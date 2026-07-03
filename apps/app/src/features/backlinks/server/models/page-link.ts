import type { ObjectId } from 'mongodb';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type {
  IPageLink,
  PageLinkDocument,
  PageLinkModel,
} from '../../interfaces/page-link';

const pageLinkSchema = new Schema<PageLinkDocument, PageLinkModel>({
  fromPage: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true,
  },
  toPath: {
    type: String,
    required: true,
    index: true,
  },
  toPage: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    default: null,
    index: true,
  },
});

pageLinkSchema.index({ fromPage: 1, toPath: 1 }, { unique: true });

/**
 * Replace a page's outbound links with the freshly extracted set:
 * insert new links, refresh existing ones, and delete links no longer present.
 */
pageLinkSchema.statics.replaceOutboundLinks = async function (
  fromPageId: ObjectId,
  resolvedRows: IPageLink[],
) {
  const toPaths = resolvedRows.map((r) => r.toPath);

  if (resolvedRows.length > 0) {
    await this.bulkWrite(
      resolvedRows.map((r) => ({
        updateOne: {
          filter: { fromPage: fromPageId, toPath: r.toPath },
          update: { $set: { toPage: r.toPage } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  await this.deleteMany({
    fromPage: fromPageId,
    toPath: { $nin: toPaths },
  });
};

/**
 * Find IDs to all pages linking to this page.
 */
pageLinkSchema.statics.findBacklinkSources = async function (
  toPageId: ObjectId,
): Promise<ObjectId[]> {
  return await this.distinct('fromPage', { toPage: toPageId });
};

/**
 * Delete links from permanently deleted pages and set links linking there to broken.
 */
pageLinkSchema.statics.reconcileDeletedPages = async function (
  pageIds: ObjectId[],
) {
  await this.updateMany(
    { toPage: { $in: pageIds } },
    { $set: { toPage: null } },
  );

  await this.deleteMany({
    fromPage: { $in: pageIds },
  });
};

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  pageLinkSchema,
);
