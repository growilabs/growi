import { vi } from 'vitest';

import type { PrismaClient } from '~/utils/prisma';

// defer the instantiation of PrismaClient until after MONGO_URI is set by a setup file
vi.mock('~/utils/prisma', async (importOriginal) => {
  const mod = await importOriginal<typeof import('~/utils/prisma')>();
  let prisma: PrismaClient;
  return {
    ...mod,
    get prisma() {
      prisma ??= mod.createPrisma();
      return prisma;
    },
  };
});
