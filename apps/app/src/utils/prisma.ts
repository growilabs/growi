import { extension as CommentExtension } from '~/features/comment/server';
import { extension as MastraRefreshedModelCatalogExtension } from '~/features/mastra/server/models/refreshed-model-catalog';
import {
  PrismaClient as OriginalPrismaClient,
  Prisma,
} from '~/generated/prisma/client';
import { extension as BookmarkExtension } from '~/server/models/bookmark';
import { extension as ExternalAccountExtension } from '~/server/models/external-account';
import { extension as UserExtension } from '~/server/models/user/index.prisma';

export interface PaginateOptions<TWhere, TOrderBy, TInclude, TSelect> {
  page?: number;
  limit?: number;
  where?: TWhere;
  orderBy?: TOrderBy;
  include?: TInclude;
  select?: TSelect;
}

export interface PaginateResult<T> {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  pagingCounter: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: number | null;
  prevPage: number | null;
}

// Minimal shape needed to call findMany/count on the extension context.
// `T` is intentionally left unconstrained on `paginate` below: constraining it
// forces TypeScript to eagerly validate the constraint against `this` at every
// call site, including extension files (e.g. external-account.ts) that call
// `prisma.<model>.paginate()` through `Prisma.getExtensionContext<typeof prisma.X>(this)`
// -- a self-referential type that only resolves correctly when checked from
// *outside* the circular prisma.ts <-> model-extension import cycle. Casting
// `this` itself to this interface (a single cast, not `as unknown as`) avoids
// that eager check while still giving `context.findMany`/`context.count` real
// types instead of `any`.
interface PaginatableDelegate {
  findMany(args: unknown): Promise<unknown[]>;
  count(args: { where?: unknown }): Promise<number>;
}

export const createPrisma = (datasourceUrl?: string) =>
  new OriginalPrismaClient(
    datasourceUrl != null ? { datasourceUrl } : undefined,
  )
    .$extends({
      result: {
        $allModels: {
          // for backward compatibility with mongoose
          _id: {
            // biome-ignore lint/suspicious/noTsIgnore: @ts-ignore may be removed after all models have been migrated to use `id` instead of `_id`
            // @ts-ignore
            needs: { id: true },
            compute(model) {
              return model.id;
            },
          },
          // for backward compatibility with mongoose
          __v: {
            // biome-ignore lint/suspicious/noTsIgnore: @ts-ignore may be removed after all models have been migrated to use `v` instead of `__v`
            // @ts-ignore
            needs: { v: true },
            compute(model) {
              return model.v;
            },
          },
        },
      },
      query: {
        $allModels: {
          update({ args, query }) {
            args.data = {
              ...args.data,
              v: {
                increment: 1,
              },
            };
            return query(args);
          },
          updateMany({ args, query }) {
            args.data = {
              ...args.data,
              v: {
                increment: 1,
              },
            };
            return query(args);
          },
        },
      },
      model: {
        $allModels: {
          // compatible with mongoose-paginate-v2
          async paginate<T, A extends Prisma.Args<T, 'findMany'>>(
            this: T,
            options: PaginateOptions<
              A['where'],
              A['orderBy'],
              A['include'],
              A['select']
            > = {},
          ): Promise<PaginateResult<Prisma.Result<T, A, 'findMany'>[number]>> {
            const context = Prisma.getExtensionContext(
              this as PaginatableDelegate,
            );
            const page = options.page ?? 1;
            const limit = options.limit ?? 10;
            const skip = (page - 1) * limit;

            const findArgs = {
              where: options.where,
              orderBy: options.orderBy,
              include: options.include,
              select: options.select,
              skip,
              take: limit,
            };

            const [docs, totalDocs] = await Promise.all([
              context.findMany(findArgs),
              context.count({ where: options.where }),
            ]);

            const totalPages = Math.ceil(totalDocs / limit);

            return {
              docs: docs as Array<Prisma.Result<T, A, 'findMany'>[number]>,
              totalDocs,
              limit,
              page,
              pagingCounter: page,
              totalPages,
              hasNextPage: page < totalPages,
              hasPrevPage: page > 1,
              nextPage: page < totalPages ? page + 1 : null,
              prevPage: page > 1 ? page - 1 : null,
            };
          },
        },
      },
    })
    .$extends(BookmarkExtension)
    .$extends(CommentExtension)
    .$extends(ExternalAccountExtension)
    .$extends(MastraRefreshedModelCatalogExtension)
    .$extends(UserExtension);

export const prisma = createPrisma();

export type PrismaClient = ReturnType<typeof createPrisma>;
