import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  createAttachmentOrphanSweeper,
  type OrphanSweepIndexOperations,
} from './attachment-orphan-sweeper';

const INDEX = 'attachments-rebuild';

/**
 * An index holding docs of `pageIds`, listed `listingSize` page ids at a
 * time in id order, the way the real index lists them.
 */
const makeIndexFake = (pageIds: string[], listingSize = 2) => {
  const remaining = new Set(pageIds);
  const operations = mock<OrphanSweepIndexOperations>();
  operations.listPageIds.mockImplementation(async (_index, after) => {
    const rest = [...remaining]
      .sort()
      .filter((id) => after == null || id > after);
    const listed = rest.slice(0, listingSize);
    return {
      pageIds: listed,
      after: rest.length > listingSize ? listed.at(-1) : undefined,
    };
  });
  operations.removePagesFromIndex.mockImplementation(async (ids) => {
    for (const id of ids) remaining.delete(id);
  });
  return { operations, remaining: () => [...remaining].sort() };
};

/** The pages that still exist in MongoDB. */
const givenExistingPages = (existingIds: string[]) => {
  const Page = {
    find: (query: { _id: { $in: string[] } }) => ({
      lean: async () =>
        query._id.$in
          .filter((id) => existingIds.includes(id))
          .map((id) => ({ _id: id })),
    }),
  };
  // WHY: mongoose.model returns a full Model; the sweeper only calls find().lean()
  vi.spyOn(mongoose, 'model').mockReturnValue(
    Page as unknown as ReturnType<typeof mongoose.model>,
  );
};

describe('AttachmentOrphanSweeper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the docs of every page that no longer exists, however many listings the index needs', async () => {
    const index = makeIndexFake(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    givenExistingPages(['p2', 'p5', 'p6']);

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(index.remaining()).toEqual(['p2', 'p5', 'p6']);
    expect(result).toEqual({ removed: 4, failed: 0 });
  });

  it('removes nothing when every page still exists', async () => {
    const index = makeIndexFake(['p1', 'p2', 'p3']);
    givenExistingPages(['p1', 'p2', 'p3']);

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(index.remaining()).toEqual(['p1', 'p2', 'p3']);
    expect(result).toEqual({ removed: 0, failed: 0 });
  });

  it('removes nothing from an empty index', async () => {
    const index = makeIndexFake([]);
    givenExistingPages([]);

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(result).toEqual({ removed: 0, failed: 0 });
  });

  it('counts the pages of a failed removal and goes on with the rest of the index', async () => {
    const index = makeIndexFake(['p1', 'p2', 'p3', 'p4']);
    givenExistingPages([]);
    index.operations.removePagesFromIndex.mockRejectedValueOnce(
      new Error('delete failed'),
    );

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(index.remaining()).toEqual(['p1', 'p2']);
    expect(result).toEqual({ removed: 2, failed: 2 });
  });

  it('reports what it removed so far, without throwing, when the index stops answering', async () => {
    const index = makeIndexFake(['p1', 'p2', 'p3', 'p4']);
    givenExistingPages([]);
    const listFirst = index.operations.listPageIds.getMockImplementation();
    index.operations.listPageIds
      .mockImplementationOnce((...args) => listFirst?.(...args) as never)
      .mockRejectedValueOnce(new Error('ES unreachable'));

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(result).toEqual({ removed: 2, failed: 0 });
  });

  it('removes nothing, without throwing, when MongoDB cannot be asked', async () => {
    const index = makeIndexFake(['p1']);
    vi.spyOn(mongoose, 'model').mockImplementation(() => {
      throw new Error('MongoDB disconnected');
    });

    const result = await createAttachmentOrphanSweeper(index.operations).sweep(
      INDEX,
    );

    expect(index.remaining()).toEqual(['p1']);
    expect(result).toEqual({ removed: 0, failed: 0 });
  });
});
