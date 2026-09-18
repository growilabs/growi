import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from './page-link-indexes';

// pagelinks is prisma-only, and the harness skips migrations on the in-memory
// MongoDB, so the indexes have to be applied here.
beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
});

describe('removeLinksForPages (integration)', () => {
  // Reads the whole collection, not just the rows expected to change — otherwise an
  // over-broad filter would pass.
  const allRows = async () => {
    const rows = await prisma.pagelinks.findMany({
      select: { fromPageId: true, toPath: true, toPageId: true },
      orderBy: [{ fromPageId: 'asc' }, { toPath: 'asc' }],
    });
    return rows;
  };

  beforeEach(async () => {
    await prisma.pagelinks.deleteMany({});
  });

  it('deletes the gone pages outbound rows and nulls inbound caches pointing at them', async () => {
    const gone = new Types.ObjectId();
    const survivor = new Types.ObjectId();

    await prisma.pagelinks.createMany({
      data: [
        { fromPageId: gone.toString(), toPath: '/target-a', toPageId: null },
        {
          fromPageId: gone.toString(),
          toPath: '/target-b',
          toPageId: survivor.toString(),
        },
        {
          fromPageId: survivor.toString(),
          toPath: '/gone',
          toPageId: gone.toString(),
        },
      ],
    });

    await prisma.pagelinks.removeLinksForPages([gone]);

    expect(await allRows()).toEqual([
      // toPath survives; only the cache is cleared, which is what makes it `broken`
      {
        fromPageId: survivor.toString(),
        toPath: '/gone',
        toPageId: null,
      },
    ]);
  });

  it('leaves rows unrelated to the given pages untouched', async () => {
    const gone = new Types.ObjectId();
    const other = new Types.ObjectId();
    const otherTarget = new Types.ObjectId();

    await prisma.pagelinks.createMany({
      data: [
        { fromPageId: gone.toString(), toPath: '/x', toPageId: null },
        {
          fromPageId: other.toString(),
          toPath: '/y',
          toPageId: otherTarget.toString(),
        },
      ],
    });

    await prisma.pagelinks.removeLinksForPages([gone]);

    expect(await allRows()).toEqual([
      {
        fromPageId: other.toString(),
        toPath: '/y',
        toPageId: otherTarget.toString(),
      },
    ]);
  });

  it('handles a batch, including a row that is both a gone source and a gone target', async () => {
    const goneA = new Types.ObjectId();
    const goneB = new Types.ObjectId();
    const survivor = new Types.ObjectId();

    await prisma.pagelinks.createMany({
      data: [
        // Both gone: deleted rather than nulled, so no orphan row is left behind
        {
          fromPageId: goneA.toString(),
          toPath: '/gone-b',
          toPageId: goneB.toString(),
        },
        {
          fromPageId: survivor.toString(),
          toPath: '/gone-a',
          toPageId: goneA.toString(),
        },
        {
          fromPageId: survivor.toString(),
          toPath: '/gone-b',
          toPageId: goneB.toString(),
        },
      ],
    });

    await prisma.pagelinks.removeLinksForPages([goneA, goneB]);

    expect(await allRows()).toEqual([
      { fromPageId: survivor.toString(), toPath: '/gone-a', toPageId: null },
      { fromPageId: survivor.toString(), toPath: '/gone-b', toPageId: null },
    ]);
  });

  it('is idempotent', async () => {
    const gone = new Types.ObjectId();
    const survivor = new Types.ObjectId();

    await prisma.pagelinks.createMany({
      data: [
        { fromPageId: gone.toString(), toPath: '/x', toPageId: null },
        {
          fromPageId: survivor.toString(),
          toPath: '/gone',
          toPageId: gone.toString(),
        },
      ],
    });

    await prisma.pagelinks.removeLinksForPages([gone]);
    const afterFirst = await allRows();
    await prisma.pagelinks.removeLinksForPages([gone]);

    expect(await allRows()).toEqual(afterFirst);
  });

  // Pins the contract, not the guard clause — `$in: []` matches nothing, so this stays
  // green without the early return (verified by mutation). It catches a filter that
  // stopped narrowing by id.
  it('writes nothing when given no page ids', async () => {
    const from = new Types.ObjectId();
    const to = new Types.ObjectId();
    await prisma.pagelinks.create({
      data: {
        fromPageId: from.toString(),
        toPath: '/kept',
        toPageId: to.toString(),
      },
    });

    await prisma.pagelinks.removeLinksForPages([]);

    expect(await allRows()).toEqual([
      { fromPageId: from.toString(), toPath: '/kept', toPageId: to.toString() },
    ]);
  });
});
