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
 *
 * Low-level primitive: writes exactly the rows it is given, with no filtering.
 * Callers must go through the `syncOutboundLinks` service instead, which drops
 * self-links before delegating here — do NOT call this static directly from
 * event handlers.
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

/**
 * Point every row linking to `toPath` at `toPage` (null = nothing resolves there,
 * i.e. broken).
 *
 * Low-level primitive: writes the target it is given, resolving nothing. Callers
 * must go through the `reResolveByToPath` service, which derives `toPage` from
 * `toPath` — do NOT call this static directly from event handlers.
 */
pageLinkSchema.statics.repointInboundLinks = async function (
  toPath: string,
  toPage: Types.ObjectId | null,
): Promise<void> {
  // `toPath` becomes a query filter, so a value that is not a plain string turns
  // this into a collection-wide write: an operator object ({ $ne: null }) matches
  // every row. Callers can reach here with one despite the declared type — an
  // unvalidated payload, or a lean page document whose `path` was not selected.
  // Refuse rather than write; there is no correct partial answer.
  if (typeof toPath !== 'string' || toPath.length === 0) {
    throw new Error(
      `repointInboundLinks requires a non-empty path string, received ${typeof toPath}`,
    );
  }

  // Skip — not delete — a row whose source is the target itself: `dropSelfLinks`
  // keeps that invariant outbound, and row existence is owned by
  // `replaceOutboundLinks`.
  const filter =
    toPage == null ? { toPath } : { toPath, fromPage: { $ne: toPage } };

  await this.updateMany(filter, { $set: { toPage } });
};

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  pageLinkSchema,
);
