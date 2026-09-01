import { Types } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';

import type { IPageLink } from '../../interfaces/page-link';

// Prisma-only collection: no mongoose schema, so its indexes are provisioned by
// migrations/20260901064500-add-indexes-to-pagelinks.js rather than on connect.
// `Types.ObjectId` here is the id type the rest of the server passes around, not a
// mongoose data-access dependency.
export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    // No `result` block: the _id/__v aliases the migrated models declare exist for
    // mongoose callers, and this collection has none.
    model: {
      pagelinks: {
        /**
         * Replace a page's outbound links with the freshly extracted set:
         * insert new links, refresh existing ones, and delete links no longer present.
         *
         * Low-level primitive: writes exactly the rows it is given, with no filtering.
         * Callers must go through the `syncOutboundLinks` service instead, which drops
         * self-links before delegating here — do NOT call this static directly from
         * event handlers.
         */
        async replaceOutboundLinks(
          fromPageId: Types.ObjectId,
          resolvedRows: IPageLink[],
        ): Promise<void> {
          const fromPageIdStr = fromPageId.toString();
          const toPaths = resolvedRows.map((r) => r.toPath);

          // Two raw commands, not one bulkWrite: Prisma has no bulk-upsert API, and no
          // portable single command mixes upserts with a delete pre-MongoDB-8.0. That puts
          // a round trip between them, so two concurrent replaces of the same fromPage
          // could interleave and drop rows — safe only because PageLinkUpsertQueue never
          // drains a page concurrently with itself.
          if (resolvedRows.length > 0) {
            await client.$runCommandRaw({
              update: 'pagelinks',
              ordered: true,
              updates: resolvedRows.map((r) => ({
                q: { fromPage: { $oid: fromPageIdStr }, toPath: r.toPath },
                u: {
                  $set: {
                    toPage:
                      r.toPage != null ? { $oid: r.toPage.toString() } : null,
                  },
                },
                upsert: true,
              })),
            });
          }

          await client.$runCommandRaw({
            delete: 'pagelinks',
            deletes: [
              {
                q: {
                  fromPage: { $oid: fromPageIdStr },
                  toPath: { $nin: toPaths },
                },
                limit: 0,
              },
            ],
          });
        },

        /**
         * Find IDs to all pages linking to this page.
         */
        async findBacklinkSources(
          toPageId: Types.ObjectId,
        ): Promise<Types.ObjectId[]> {
          // Native `distinct`, not Prisma's `findMany({ distinct })`: both ride toPage_1,
          // but Prisma dedupes in the query engine, so it streams a whole document per
          // inbound link to the client first — measured 2.4x slower at a 20,000-inbound hub.
          const result = await client.$runCommandRaw({
            distinct: 'pagelinks',
            key: 'fromPage',
            query: { toPage: { $oid: toPageId.toString() } },
          });

          const values = Array.isArray(result.values) ? result.values : [];
          return values.flatMap((value) =>
            // Extended JSON: the driver hands ObjectIds back as { $oid }.
            typeof value === 'object' &&
            value != null &&
            '$oid' in value &&
            typeof value.$oid === 'string'
              ? [new Types.ObjectId(value.$oid)]
              : [],
          );
        },

        /**
         * Point every row whose `toPath` field equals `toPath` at `toPage` (null =
         * broken). One bulk update, matched by text — not per-source-page.
         *
         * Low-level primitive: writes the target it's given, resolving nothing itself.
         * `reResolveByToPath` calls this once per already-resolved candidate path — do
         * NOT call this static directly from event handlers.
         */
        async repointInboundLinks(
          toPath: string,
          toPage: Types.ObjectId | null,
        ): Promise<void> {
          // Both arguments are validated here because neither is protected downstream:
          // `toPath` lands in a query filter, where an operator object from an unvalidated
          // caller would match every row; `toPage` lands in an aggregation pipeline, which
          // is not type-checked, so an expression object there is evaluated and its
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

          const toPageOid = toPage != null ? { $oid: toPage.toString() } : null;

          // A raw command because the $cond against the document's own `fromPage` is a
          // pipeline update, which the Prisma query API cannot express.
          //
          // The row whose own source is the target caches null, not the target: a page is
          // never its own backlink. Clearing it — rather than leaving it alone — is what
          // stops the path's previous occupant from staying cached there forever. The row
          // itself survives; `replaceOutboundLinks` owns row existence.
          await client.$runCommandRaw({
            update: 'pagelinks',
            updates: [
              {
                q: { toPath },
                u: [
                  {
                    $set: {
                      toPage: {
                        $cond: [
                          { $eq: ['$fromPage', toPageOid] },
                          null,
                          toPageOid,
                        ],
                      },
                    },
                  },
                ],
                multi: true,
              },
            ],
          });
        },
      },
    },
  });
});
