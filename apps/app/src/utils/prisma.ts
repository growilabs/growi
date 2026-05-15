import { extension as CommentExtension } from '~/features/comment/server';
import { PrismaClient as OriginalPrismaClient } from '~/generated/prisma/client';

export const createPrisma = () =>
  new OriginalPrismaClient()
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
    })
    .$extends(CommentExtension);

export const prisma = createPrisma();

export type PrismaClient = ReturnType<typeof createPrisma>;
