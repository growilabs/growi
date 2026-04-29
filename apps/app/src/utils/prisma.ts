import { PrismaClient as OriginalPrismaClient } from '~/generated/prisma/client';

export const prisma = new OriginalPrismaClient();
export type PrismaClient = typeof prisma;
