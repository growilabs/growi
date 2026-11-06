import type { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

// Shared arg builders so the standalone model and the transactional path
// (auditlog-es-sync-tx) write the token identically and can never drift apart.
export const buildResumeTokenUpsertArgs = (
  key: string,
  token: unknown,
): Prisma.changestream_resume_tokensUpsertArgs => {
  const value = token as Prisma.InputJsonValue;
  return {
    where: { key },
    update: { token: value },
    create: { key, token: value },
  };
};

export const buildResumeTokenDeleteArgs = (
  key: string,
): Prisma.changestream_resume_tokensDeleteManyArgs => ({ where: { key } });

export const ChangeStreamResumeToken = {
  async load(key: string): Promise<unknown> {
    const doc = await prisma.changestream_resume_tokens.findUnique({
      where: { key },
    });
    return doc?.token ?? null;
  },

  async upsert(key: string, token: unknown): Promise<void> {
    await prisma.changestream_resume_tokens.upsert(
      buildResumeTokenUpsertArgs(key, token),
    );
  },

  async clear(key: string): Promise<void> {
    await prisma.changestream_resume_tokens.deleteMany(
      buildResumeTokenDeleteArgs(key),
    );
  },
};
