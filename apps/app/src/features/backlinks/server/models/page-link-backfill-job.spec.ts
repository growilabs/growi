import { mock } from 'vitest-mock-extended';

import type { Prisma, PrismaClient } from '~/generated/prisma/client';

import { createPageLinkBackfillJobModel } from './page-link-backfill-job';

// A write-concern failure cannot be provoked on a real single-node test server, so the reply
// MongoDB would send is canned and handed to the model's real `tryClaim`.
const claimWithReply = (reply: Prisma.JsonObject): Promise<boolean> => {
  const client = mock<PrismaClient>({
    $runCommandRaw: vi.fn().mockResolvedValue(reply),
  });
  return createPageLinkBackfillJobModel(client).tryClaim('owner-a', {
    leaseMs: 60_000,
  });
};

describe('pagelinkbackfilljobs.tryClaim, given the reply MongoDB sends', () => {
  it('reports a claim when the write was applied and a document came back', async () => {
    await expect(
      claimWithReply({ ok: 1, value: { status: 'running' } }),
    ).resolves.toBe(true);
  });

  it('reports no claim when no document matched', async () => {
    await expect(claimWithReply({ ok: 1, value: null })).resolves.toBe(false);
  });

  // The document came back, but the write is not durable: after a primary change it can be
  // rolled back and a second instance would claim too.
  it('throws rather than reporting a claim when the write concern was not satisfied', async () => {
    await expect(
      claimWithReply({
        ok: 1,
        value: { status: 'running' },
        writeConcernError: {
          code: 64,
          errmsg: 'waiting for replication timed out',
        },
      }),
    ).rejects.toThrow(/tryClaim failed.*waiting for replication timed out/);
  });

  it('throws rather than reporting a claim when the write itself failed', async () => {
    await expect(
      claimWithReply({
        ok: 1,
        value: { status: 'running' },
        writeErrors: [{ code: 2, errmsg: 'bad update operator' }],
      }),
    ).rejects.toThrow(/tryClaim failed.*bad update operator/);
  });
});
