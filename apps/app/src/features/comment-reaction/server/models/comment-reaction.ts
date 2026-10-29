import { Prisma } from '~/generated/prisma/client';

// Prisma-only model: no Mongoose schema, indexes come from the migration script.
export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      commentreactions: {
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
  });
});
