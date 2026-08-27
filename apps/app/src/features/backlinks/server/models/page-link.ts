import { Schema, Types } from 'mongoose';

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
  },
  toPath: {
    type: String,
    required: true,
  },
  toPage: {
    type: Schema.Types.ObjectId,
    ref: 'Page',
    default: null,
    index: true,
  },
});

// Only the indexes an actual query uses:
//  - { fromPage, toPath } unique — serves replaceOutboundLinks' per-row upsert
//    filter, its `toPath: { $nin }` delete, and every fromPage-only lookup
//    (fromPage is the prefix), so a standalone fromPage index would be dead weight
//  - toPage — serves findBacklinkSources
// toPath alone has no query yet; B4's re-resolve-by-path adds one and should add
// the index with it (the compound cannot serve toPath alone — wrong prefix).
pageLinkSchema.index({ fromPage: 1, toPath: 1 }, { unique: true });
// { fromPage, toPath } above can't serve a toPath-only query (wrong prefix) —
// repointInboundLinks filters on toPath alone, so it needs its own index.
pageLinkSchema.index({ toPath: 1 });

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
  // Both arguments are validated here because neither is protected downstream:
  // `toPath` lands in a query filter, where an operator object from an unvalidated
  // caller would match every row; `toPage` lands in an aggregation pipeline, which
  // mongoose does not cast, so an expression object there is evaluated and its
  // result written into the column.
  if (typeof toPath !== 'string' || toPath.length === 0) {
    throw new Error(
      `repointInboundLinks requires a non-empty path string, received ${typeof toPath}`,
    );
  }
  if (toPage != null && !(toPage instanceof Types.ObjectId)) {
    throw new Error(
      'repointInboundLinks requires an ObjectId or null as toPage',
    );
  }

  // The row whose own source is the target caches null, not the target: a page is
  // never its own backlink. Clearing it — rather than leaving it alone — is what
  // stops the path's previous occupant from staying cached there forever. The row
  // itself survives; `replaceOutboundLinks` owns row existence, and
  // `dropSelfLinks` drops it on the source's next save.
  //
  // One pipeline update rather than two plain ones, so no row is ever momentarily
  // its own backlink and a failure cannot leave it that way.
  await this.updateMany({ toPath }, [
    {
      $set: {
        toPage: { $cond: [{ $eq: ['$fromPage', toPage] }, null, toPage] },
      },
    },
  ]);
};

export default getOrCreateModel<PageLinkDocument, PageLinkModel>(
  'PageLink',
  pageLinkSchema,
);
