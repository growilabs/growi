import { vi } from 'vitest';

import type { PrismaClient } from '~/utils/prisma';

// defer the instantiation of PrismaClient until after MONGO_URI is set by a setup file
vi.mock('~/utils/prisma', async (importOriginal) => {
  const mod = await importOriginal<typeof import('~/utils/prisma')>();
  const { getTestDbConfig } = await import('./mongo/utils');
  let prisma: PrismaClient;
  return {
    ...mod,
    get prisma() {
      // Bind Prisma to the SAME per-worker database as mongoose
      // (growi_test_<workerId>). The URI is passed explicitly rather than read
      // from the process.env.MONGO_URI global: in CI that env var stays at the
      // un-suffixed base DB, which would otherwise split Prisma and mongoose
      // across two databases. Resolved at first access, after the mongo setup
      // file has connected.
      prisma ??= mod.createPrisma(getTestDbConfig().mongoUri ?? undefined);
      return prisma;
    },
  };
});
