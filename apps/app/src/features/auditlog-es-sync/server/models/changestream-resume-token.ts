import type { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

export const ChangeStreamResumeToken = {
  async load(key: string): Promise<unknown> {
    const doc = await prisma.changestream_resume_tokens.findUnique({
      where: { key },
    });
    return doc?.token ?? null;
  },

  async upsert(key: string, token: unknown): Promise<void> {
    const value = token as Prisma.InputJsonValue;
    await prisma.changestream_resume_tokens.upsert({
      where: { key },
      update: { token: value },
      create: { key, token: value },
    });
  },

  async clear(key: string): Promise<void> {
    await prisma.changestream_resume_tokens.deleteMany({ where: { key } });
  },
};
