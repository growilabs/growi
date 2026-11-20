import { prisma } from '~/utils/prisma';

import { AUDITLOG_SYNC_STATUS_KEY } from './auditlog-es-sync-status';
import {
  buildResumeTokenDeleteArgs,
  buildResumeTokenUpsertArgs,
} from './changestream-resume-token';

const setUnsyncedTrueArgs = {
  where: { key: AUDITLOG_SYNC_STATUS_KEY },
  update: { hasUnsyncedEvents: true },
  create: { key: AUDITLOG_SYNC_STATUS_KEY, hasUnsyncedEvents: true },
};

// Atomic so a crash between the two writes can't leave the token past a skipped (poison)
// batch with the flag still false — that would be a silent ES gap with no signal to rebuild.
export const markUnsyncedAndAdvanceToken = async (
  streamKey: string,
  token: unknown,
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.auditlog_es_sync_status.upsert(setUnsyncedTrueArgs);
    await tx.changestream_resume_tokens.upsert(
      buildResumeTokenUpsertArgs(streamKey, token),
    );
  });
};

// History-lost recovery. Atomic so the token is never cleared (resume-from-current, gap
// accepted) unless the flag is also recorded.
export const markUnsyncedAndClearToken = async (
  streamKey: string,
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await tx.auditlog_es_sync_status.upsert(setUnsyncedTrueArgs);
    await tx.changestream_resume_tokens.deleteMany(
      buildResumeTokenDeleteArgs(streamKey),
    );
  });
};
