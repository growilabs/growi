import { prisma } from '~/utils/prisma';

import { throwOnWriteErrors } from '../models/throw-on-write-errors';
import { readBacklinksIndexState } from './read-backlinks-index-state';

const COLLECTION = 'pagelinkbackfilljobs';

describe('readBacklinksIndexState (integration)', () => {
  beforeEach(async () => {
    await prisma.pagelinkbackfilljobs.deleteMany({});
  });

  // The panel's read is served to every reader, so it must stay a read: the boot upsert
  // that the admin endpoints run would turn each panel view into a write.
  it('reads a missing job document as not built and leaves it missing', async () => {
    const state = await readBacklinksIndexState();

    expect(state).toEqual({
      coverage: 'none',
      coveredSince: null,
    });
    expect(await prisma.pagelinkbackfilljobs.count()).toBe(0);
  });

  it('summarizes the stored job document', async () => {
    await prisma.pagelinkbackfilljobs.ensureExists();
    const result = await prisma.$runCommandRaw({
      update: COLLECTION,
      updates: [
        {
          q: {},
          u: {
            $set: {
              status: 'running',
              coverage: 'partial',
              coveredSince: { $date: '2026-03-01T12:00:00.000Z' },
              lastError: 'must not reach a reader',
            },
          },
        },
      ],
    });
    throwOnWriteErrors(result, 'test patch of the job document');

    const state = await readBacklinksIndexState();

    expect(state).toEqual({
      coverage: 'partial',
      coveredSince: '2026-03-01T12:00:00.000Z',
    });
  });
});
