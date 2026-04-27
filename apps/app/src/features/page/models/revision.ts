import { Prisma } from '~/generated/prisma/client';

export const extension = Prisma.defineExtension((client) =>
  client.$extends({}),
);
