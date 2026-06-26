// TODO:
// This is a temporary solution to keep the typings of the prisma client while defining the extension.
// Defining a prisma extension in js file loosen typings of the prisma client, so we define the extension in ts file and merge it into the js file later.
// When migrating users model to Prisma, this file should be removed and merged into `apps/app/src/server/models/user/index.js`.

import { Prisma, type users } from '~/generated/prisma/client';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      users: {
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
        updateLastLoginAt: {
          needs: { id: true },
          compute(user) {
            return async (
              lastLoginAt: string,
              callback: (err: unknown, result: users | null) => void,
            ) => {
              try {
                const result = await client.users.update({
                  where: {
                    id: user.id,
                  },
                  data: {
                    lastLoginAt,
                  },
                });
                return callback(null, result);
              } catch (err) {
                return callback(err, null);
              }
            };
          },
        },
      },
    },
  });
});
