import { prisma } from '~/utils/prisma';

import { ChangeStreamResumeToken } from './changestream-resume-token';

describe('ChangeStreamResumeToken', () => {
  const KEY = 'test-stream';

  afterEach(async () => {
    await prisma.changestream_resume_tokens.deleteMany({});
  });

  describe('load', () => {
    it('returns null for a non-existent key', async () => {
      const result = await ChangeStreamResumeToken.load(KEY);
      expect(result).toBeNull();
    });
  });

  describe('upsert + load', () => {
    it('returns the upserted token', async () => {
      const token = { _data: 'abc123' };
      await ChangeStreamResumeToken.upsert(KEY, token);
      expect(await ChangeStreamResumeToken.load(KEY)).toEqual(token);
    });

    it('second upsert with the same key overwrites the first (upsert semantics)', async () => {
      await ChangeStreamResumeToken.upsert(KEY, { _data: 'first' });
      await ChangeStreamResumeToken.upsert(KEY, { _data: 'second' });

      expect(await ChangeStreamResumeToken.load(KEY)).toEqual({
        _data: 'second',
      });
      const count = await prisma.changestream_resume_tokens.count({
        where: { key: KEY },
      });
      expect(count).toBe(1);
    });
  });

  describe('clear', () => {
    it('load returns null after clear', async () => {
      await ChangeStreamResumeToken.upsert(KEY, { _data: 'abc123' });
      await ChangeStreamResumeToken.clear(KEY);
      expect(await ChangeStreamResumeToken.load(KEY)).toBeNull();
    });
  });
});
