import type { Types } from 'mongoose';
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
  fromPageId: Types.ObjectId,
  resolvedRows: IPageLink[],
): Promise<void> {
  const toPaths = resolvedRows.map((r) => r.toPath);

  // One ordered bulkWrite (not two awaited calls, not a transaction): keeps the
  // replace in a single command and stays standalone-MongoDB compatible. The index
  // is a derived cache and concurrent same-page upserts are idempotent, so strict
  // atomicity isn't required.
  await this.bulkWrite(
    [
      ...resolvedRows.map((r) => ({
        updateOne: {
          filter: { fromPage: fromPageId, toPath: r.toPath },
          update: { $set: { toPage: r.toPage } },
          upsert: true,
        },
      })),
      {
        deleteMany: {
          filter: { fromPage: fromPageId, toPath: { $nin: toPaths } },
        },
      },
    ],
    { ordered: true },
  );
};

/**
 * Find IDs to all pages linking to this page.
 */
pageLinkSchema.statics.findBacklinkSources = async function (
  toPageId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  return await this.distinct('fromPage', { toPage: toPageId });
};

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  pageLinkSchema,
);
