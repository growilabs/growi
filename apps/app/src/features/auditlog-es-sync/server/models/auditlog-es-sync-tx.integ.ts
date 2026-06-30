import { prisma } from '~/utils/prisma';

import { AUDITLOG_SYNC_STATUS_KEY } from './auditlog-es-sync-status';
import {
  markUnsyncedAndAdvanceToken,
  markUnsyncedAndClearToken,
} from './auditlog-es-sync-tx';

const STREAM_KEY = 'test-stream';

const readUnsyncedFlag = async () => {
  const doc = await prisma.auditlog_es_sync_status.findUnique({
    where: { key: AUDITLOG_SYNC_STATUS_KEY },
  });
  return doc?.hasUnsyncedEvents ?? false;
};

const readToken = async (key: string) => {
  const doc = await prisma.changestream_resume_tokens.findUnique({
    where: { key },
  });
  return doc?.token ?? null;
};

describe('auditlog ES sync transactions', () => {
  afterEach(async () => {
    await prisma.auditlog_es_sync_status.deleteMany({});
    await prisma.changestream_resume_tokens.deleteMany({});
  });

  describe('markUnsyncedAndAdvanceToken', () => {
    it('sets the unsynced flag and stores the resume token together', async () => {
      await markUnsyncedAndAdvanceToken(STREAM_KEY, { _data: 'tok' });

      expect(await readUnsyncedFlag()).toBe(true);
      expect(await readToken(STREAM_KEY)).toEqual({ _data: 'tok' });
    });

    it('rolls back the flag when storing the token fails', async () => {
      // The required Json token column rejects undefined, so the second write
      // fails and the transaction must undo the flag set by the first write.
      await expect(
        markUnsyncedAndAdvanceToken(STREAM_KEY, undefined),
      ).rejects.toThrow();

      expect(await readUnsyncedFlag()).toBe(false);
      expect(await readToken(STREAM_KEY)).toBeNull();
    });
  });

  describe('markUnsyncedAndClearToken', () => {
    it('sets the unsynced flag and removes the resume token together', async () => {
      await prisma.changestream_resume_tokens.create({
        data: { key: STREAM_KEY, token: { _data: 'stale' } },
      });

      await markUnsyncedAndClearToken(STREAM_KEY);

      expect(await readUnsyncedFlag()).toBe(true);
      expect(await readToken(STREAM_KEY)).toBeNull();
    });

    it('succeeds when no resume token exists', async () => {
      await markUnsyncedAndClearToken(STREAM_KEY);

      expect(await readUnsyncedFlag()).toBe(true);
      expect(await readToken(STREAM_KEY)).toBeNull();
    });
  });
});
