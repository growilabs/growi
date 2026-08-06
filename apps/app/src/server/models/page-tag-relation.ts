import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import type { IDataTagCount } from '~/interfaces/tag';
import type { prisma } from '~/utils/prisma';

import { getOrCreateModel } from '../util/mongoose-utils';

type CreateTagListWithCountOpts = {
  sortOpt?: any;
  offset?: number;
  limit?: number;
};
type CreateTagListWithCountResult = {
  data: IDataTagCount[];
  totalCount: number;
};

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const schema = new mongoose.Schema({
  relatedPage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true,
  },
  relatedTag: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tag',
    required: true,
    index: true,
  },
  isPageTrashed: {
    type: Boolean,
    default: false,
    required: true,
    index: true,
  },
});
// define unique compound index
schema.index({ relatedPage: 1, relatedTag: 1 }, { unique: true });

getOrCreateModel('PageTagRelation', schema);

type PageTagRelationWithTag = Prisma.pagetagrelationsGetPayload<{
  include: { relatedTag: true };
}>;

function hasRelatedTag(
  relation: PageTagRelationWithTag,
): relation is PageTagRelationWithTag & {
  relatedTag: NonNullable<PageTagRelationWithTag['relatedTag']>;
} {
  return relation.relatedTag !== null;
}

// Raw shape of a `createTagListWithCount` aggregation row: aggregateRaw()
// serializes ObjectId as MongoDB Extended JSON (`{ $oid: string }`), not a
// plain string.
type RawTagCountRow = {
  _id: { $oid: string };
  count: number;
  name: string;
};

export const extension = Prisma.defineExtension((client) => {
  // `client.tags` has TagExtension's custom methods (getIdToNameMap,
  // findOrCreateMany) attached at runtime -- utils/prisma.ts's `.$extends()`
  // chain applies TagExtension before PageTagRelationExtension specifically
  // for this. `Prisma.defineExtension`'s `client` parameter type can't reflect
  // chain-position-dependent extensions, so this re-typing bridges that gap;
  // it does not create a runtime dependency on `~/utils/prisma` (unlike a
  // module-level `prisma` import, which would form a circular import with
  // utils/prisma.ts and resolve to the wrong client under the test harness's
  // `vi.mock('~/utils/prisma', ...)`).
  const tagsModel = client.tags as unknown as typeof prisma.tags;

  return client.$extends({
    result: {
      pagetagrelations: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      pagetagrelations: {
        async createTagListWithCount(
          opts?: CreateTagListWithCountOpts,
        ): Promise<CreateTagListWithCountResult> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pagetagrelations>(this);
          const sortOpt = opts?.sortOpt ?? {};
          const offset = opts?.offset ?? 0;
          const limit = opts?.limit;

          const pipeline: Prisma.InputJsonValue[] = [
            { $match: { isPageTrashed: false } },
            {
              $lookup: {
                from: 'tags',
                localField: 'relatedTag',
                foreignField: '_id',
                as: 'tag',
              },
            },
            { $unwind: '$tag' },
            {
              $group: {
                _id: '$relatedTag',
                count: { $sum: 1 },
                name: { $first: '$tag.name' },
              },
            },
            { $sort: sortOpt },
            { $skip: offset },
            ...(limit != null ? [{ $limit: limit }] : []),
          ];

          const [rawRows, totalCount] = await Promise.all([
            context.aggregateRaw({ pipeline }) as unknown as Promise<
              RawTagCountRow[]
            >,
            // Matches the pre-migration `totalCount` definition exactly: a
            // distinct count of relatedTag values, INCLUDING dangling ones (no
            // `$lookup` here) -- `data` and `totalCount` intentionally diverge
            // when dangling tags exist, same as the Mongoose implementation.
            context
              .findMany({
                where: { isPageTrashed: false },
                select: { relatedTagId: true },
                distinct: ['relatedTagId'],
              })
              .then((rows) => rows.length),
          ]);

          const data: IDataTagCount[] = rawRows.map((row) => ({
            _id: row._id.$oid,
            count: row.count,
            name: row.name,
          }));

          return { data, totalCount };
        },

        async findByPageId(
          pageId: Types.ObjectId | string,
          options: { nullable?: boolean } = {},
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.pagetagrelations>(this);

          const relations = await context.findMany({
            where: { relatedPageId: pageId.toString() },
            include: { relatedTag: true },
          });

          return options.nullable ? relations : relations.filter(hasRelatedTag);
        },

        async listTagNamesByPage(pageId: Types.ObjectId | string) {
          const context =
            Prisma.getExtensionContext<typeof prisma.pagetagrelations>(this);
          const relations = await context.findByPageId(pageId);
          return relations.map((relation) => relation.relatedTag.name);
        },

        async getIdToTagNamesMap(pageIds: string[]) {
          const context =
            Prisma.getExtensionContext<typeof prisma.pagetagrelations>(this);

          const relations = await context.findMany({
            where: { relatedPageId: { in: pageIds } },
            select: { relatedPageId: true, relatedTagId: true },
          });

          if (relations.length === 0) {
            return {};
          }

          const distinctTagIds = Array.from(
            new Set(relations.map((relation) => relation.relatedTagId)),
          );
          const tagIdToNameMap = await tagsModel.getIdToNameMap(distinctTagIds);

          const pageIdToTagIds = new Map<string, string[]>();
          relations.forEach((relation) => {
            const tagIds = pageIdToTagIds.get(relation.relatedPageId) ?? [];
            pageIdToTagIds.set(relation.relatedPageId, [
              ...tagIds,
              relation.relatedTagId,
            ]);
          });

          return Object.fromEntries(
            Array.from(pageIdToTagIds.entries()).map(([pageId, tagIds]) => [
              pageId,
              tagIds
                .map((tagId) => tagIdToNameMap[tagId])
                .filter((tagName): tagName is string => tagName != null),
            ]),
          );
        },

        async updatePageTags(pageId: Types.ObjectId | string, tags: string[]) {
          if (pageId == null || tags == null) {
            throw new Error("args 'pageId' and 'tags' are required.");
          }

          const context =
            Prisma.getExtensionContext<typeof prisma.pagetagrelations>(this);

          const filteredTags = tags.filter((tag) => {
            return tag !== '';
          });

          // get relations for this page
          const relations = await context.findByPageId(pageId, {
            nullable: true,
          });

          const unlinkTagRelationIds: string[] = [];
          const relatedTagNames: string[] = [];

          relations.forEach((relation) => {
            if (relation.relatedTag == null) {
              unlinkTagRelationIds.push(relation._id);
            } else {
              relatedTagNames.push(relation.relatedTag.name);
              if (!filteredTags.includes(relation.relatedTag.name)) {
                unlinkTagRelationIds.push(relation._id);
              }
            }
          });
          const bulkDeletePromise = context.deleteMany({
            where: { id: { in: unlinkTagRelationIds } },
          });
          // find or create tags
          const tagsToCreate = filteredTags.filter((tag) => {
            return !relatedTagNames.includes(tag);
          });
          const tagEntities = await tagsModel.findOrCreateMany(tagsToCreate);

          // create relations
          // MongoDB's insertMany rejects an empty document array (unlike
          // Mongoose's insertMany([]), which no-ops), so skip the call entirely
          // when there's nothing to create.
          const bulkCreatePromise =
            tagEntities.length === 0
              ? Promise.resolve()
              : context.createMany({
                  data: tagEntities.map((relatedTag) => {
                    return {
                      relatedPageId: pageId.toString(),
                      relatedTagId: relatedTag._id,
                    };
                  }),
                });

          await Promise.all([bulkDeletePromise, bulkCreatePromise]);
        },
      },
    },
  });
});
