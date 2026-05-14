import { extension as RevisionExtension } from '~/features/page';
import { PrismaClient as OriginalPrismaClient } from '~/generated/prisma/client';

export const prisma = new OriginalPrismaClient().$extends(RevisionExtension);
export type PrismaClient = typeof prisma;
