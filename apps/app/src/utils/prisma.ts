import { extension as CommentExtension } from '~/features/comment/server';
import {
  PrismaClient as OriginalPrismaClient,
  Prisma,
} from '~/generated/prisma/client';
import { extension as ActivityExtension } from '~/server/models/activity';
import { extension as ExternalAccountExtension } from '~/server/models/external-account';
import { extension as UserExtension } from '~/server/models/user/index.prisma';

export interface PaginateOptions<TWhere, TOrderBy, TInclude, TSelect> {
  offset?: number;
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
  offset: number;
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
export interface PaginatableDelegate {
  findMany(args: unknown): Promise<unknown[]>;
  count(args: { where?: unknown }): Promise<number>;
}

/**
 * Pure paginate logic extracted for testability.
 *
 * Input: offset (exact skip value), limit.
 * Output: mongoose-paginate-v2 compatible shape, always includes `offset` field.
 *
 * Derivation formulas:
 *   page = Math.ceil((offset + 1) / limit)
 *   pagingCounter = (page - 1) * limit + 1
 *   totalPages = Math.ceil(totalDocs / limit)
 *   hasPrevPage / prevPage:
 *     - page === 1 && offset !== 0 → hasPrevPage=true, prevPage=1 (mongoose-paginate-v2 edge case)
 *     - page > 1 → hasPrevPage=true, prevPage=page-1
 *     - page === 1 && offset === 0 → hasPrevPage=false, prevPage=null
 */
export async function paginateLogic<T>(
  delegate: PaginatableDelegate,
  options: {
    offset?: number;
    limit?: number;
    where?: unknown;
    orderBy?: unknown;
    include?: unknown;
    select?: unknown;
  },
): Promise<PaginateResult<T>> {
  // Coerce defensively: Express query params (e.g. apiv3/activity.ts's
  // req.query.offset/limit) arrive as strings even after express-validator's
  // `.isInt()` (which validates but does not sanitize). Prisma's skip/take
  // reject strings with PrismaClientValidationError, unlike
  // mongoose-paginate-v2, which coerced internally.
  const offset = Number(options.offset ?? 0);
  const limit = Number(options.limit ?? 10);
  const skip = offset; // exact: skip = offset

  const findArgs = {
    where: options.where,
    orderBy: options.orderBy,
    include: options.include,
    select: options.select,
    skip,
    take: limit,
  };

  const [docs, totalDocs] = await Promise.all([
    delegate.findMany(findArgs),
    delegate.count({ where: options.where }),
  ]);

  const page = Math.ceil((offset + 1) / limit);
  const pagingCounter = (page - 1) * limit + 1;
  const totalPages = Math.ceil(totalDocs / limit);

  // mongoose-paginate-v2 compatible hasPrevPage/prevPage:
  // - page === 1 && offset !== 0: hasPrevPage=true, prevPage=1 (edge case)
  // - page > 1: hasPrevPage=true, prevPage=page-1 (normal case)
  // - page === 1 && offset === 0: hasPrevPage=false, prevPage=null
  let hasPrevPage: boolean;
  let prevPage: number | null;
  if (page === 1 && offset !== 0) {
    hasPrevPage = true;
    prevPage = 1;
  } else if (page > 1) {
    hasPrevPage = true;
    prevPage = page - 1;
  } else {
    hasPrevPage = false;
    prevPage = null;
  }

  const hasNextPage = page < totalPages;
  const nextPage = hasNextPage ? page + 1 : null;

  return {
    docs: docs as T[],
    totalDocs,
    limit,
    offset,
    page,
    pagingCounter,
    totalPages,
    hasNextPage,
    hasPrevPage,
    nextPage,
    prevPage,
  };
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

            return paginateLogic<Prisma.Result<T, A, 'findMany'>[number]>(
              context,
              options,
            );
          },
        },
      },
    })
    .$extends(ActivityExtension)
    .$extends(CommentExtension)
    .$extends(ExternalAccountExtension)
    .$extends(UserExtension);

export const prisma = createPrisma();

export type PrismaClient = ReturnType<typeof createPrisma>;
