import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import {
  copyCurrentRevisions,
  REVISION_MERGE_CHUNK_SIZE,
  type RevisionCopyEntry,
} from './copy-current-revisions';

// Read through the driver so that stored BSON types are observed as they are,
// without Prisma's or Mongoose's conversion on the way out.
const revisionsCollection = () => mongoose.connection.collection('revisions');

const newId = (): string => new Types.ObjectId().toHexString();

// Counts documents whose ObjectId / Date / __v fields carry the right BSON types.
// Checked server-side with $type: mongoose and the driver may bundle different
// bson copies, so instanceof on the client side is unreliable.
const countWithExpectedTypes = (id: string): Promise<number> =>
  revisionsCollection().countDocuments({
    _id: new Types.ObjectId(id),
    pageId: { $type: 'objectId' },
    author: { $type: 'objectId' },
    createdAt: { $type: 'date' },
    __v: { $type: 'long' },
  });

const seedRevision = async (input: {
  readonly id?: string;
  readonly pageId: string;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt?: Date;
}): Promise<string> => {
  const id = input.id ?? newId();
  // Same shape as the revisions the descendant duplication has written so far.
  await prisma.revisions.createMany({
    data: [
      {
        id,
        pageId: input.pageId,
        body: input.body,
        authorId: input.authorId,
        format: 'markdown',
        createdAt: input.createdAt,
      },
    ],
  });
  return id;
};

describe('copyCurrentRevisions', () => {
  const sourceAuthorId = newId();
  const duplicatingUserId = newId();
  const createdRevisionIds: string[] = [];

  const track = (...ids: string[]): void => {
    createdRevisionIds.push(...ids);
  };

  afterAll(async () => {
    await revisionsCollection().deleteMany({
      _id: { $in: createdRevisionIds.map((id) => new Types.ObjectId(id)) },
    });
  });

  it('stores the copy with the same fields and BSON types as a revision created through Prisma', async () => {
    const sourcePageId = newId();
    const sourceRevisionId = await seedRevision({
      pageId: sourcePageId,
      body: 'parity body',
      authorId: sourceAuthorId,
    });
    const entry: RevisionCopyEntry = {
      sourceRevisionId,
      newRevisionId: newId(),
      newPageId: newId(),
    };
    track(sourceRevisionId, entry.newRevisionId);

    await copyCurrentRevisions([entry], duplicatingUserId, async () => {});

    const prismaCreated = await revisionsCollection().findOne({
      _id: new Types.ObjectId(sourceRevisionId),
    });
    const copied = await revisionsCollection().findOne({
      _id: new Types.ObjectId(entry.newRevisionId),
    });
    expect(prismaCreated).not.toBeNull();
    expect(copied).not.toBeNull();
    expect(new Set(Object.keys(copied ?? {}))).toEqual(
      new Set(Object.keys(prismaCreated ?? {})),
    );
    expect(await countWithExpectedTypes(sourceRevisionId)).toBe(1);
    expect(await countWithExpectedTypes(entry.newRevisionId)).toBe(1);
  });

  it('gives the copy the new page id, the duplicating user as author, the source body and format, and __v 0', async () => {
    const sourceRevisionId = await seedRevision({
      pageId: newId(),
      body: 'values body',
      authorId: sourceAuthorId,
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });
    const entry: RevisionCopyEntry = {
      sourceRevisionId,
      newRevisionId: newId(),
      newPageId: newId(),
    };
    track(sourceRevisionId, entry.newRevisionId);
    const startedAt = new Date();

    await copyCurrentRevisions([entry], duplicatingUserId, async () => {});

    const copied = await prisma.revisions.findUnique({
      where: { id: entry.newRevisionId },
    });
    expect(copied).toMatchObject({
      pageId: entry.newPageId,
      authorId: duplicatingUserId,
      body: 'values body',
      format: 'markdown',
      v: 0,
    });
    expect(copied?.createdAt.getTime()).toBeGreaterThanOrEqual(
      startedAt.getTime() - 1000,
    );
  });

  it('copies only the revision the entry points at, not other revisions of the same page', async () => {
    const sourcePageId = newId();
    const oldRevisionId = await seedRevision({
      pageId: sourcePageId,
      body: 'old body',
      authorId: sourceAuthorId,
    });
    const latestRevisionId = await seedRevision({
      pageId: sourcePageId,
      body: 'latest body',
      authorId: sourceAuthorId,
    });
    const entry: RevisionCopyEntry = {
      sourceRevisionId: latestRevisionId,
      newRevisionId: newId(),
      newPageId: newId(),
    };
    track(oldRevisionId, latestRevisionId, entry.newRevisionId);

    await copyCurrentRevisions([entry], duplicatingUserId, async () => {});

    const copies = await prisma.revisions.findMany({
      where: { pageId: entry.newPageId },
    });
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      id: entry.newRevisionId,
      body: 'latest body',
    });
  });

  it('gives the copy the markdown format when the source revision has no format', async () => {
    // Revisions stored before the format field existed lack it.
    const sourceRevisionId = newId();
    await revisionsCollection().insertOne({
      _id: new Types.ObjectId(sourceRevisionId),
      pageId: new Types.ObjectId(),
      body: 'legacy body',
      author: new Types.ObjectId(sourceAuthorId),
      createdAt: new Date(),
    });
    const entry: RevisionCopyEntry = {
      sourceRevisionId,
      newRevisionId: newId(),
      newPageId: newId(),
    };
    track(sourceRevisionId, entry.newRevisionId);

    await copyCurrentRevisions([entry], duplicatingUserId, async () => {});

    const copied = await revisionsCollection().findOne({
      _id: new Types.ObjectId(entry.newRevisionId),
    });
    expect(copied?.format).toBe('markdown');
  });

  it('rejects, leaving the stored revision as it is, when a revision with the new id already exists', async () => {
    const sourceRevisionId = await seedRevision({
      pageId: newId(),
      body: 'source body',
      authorId: sourceAuthorId,
    });
    const occupiedPageId = newId();
    const newRevisionId = await seedRevision({
      pageId: occupiedPageId,
      body: 'existing body',
      authorId: sourceAuthorId,
    });
    track(sourceRevisionId, newRevisionId);

    await expect(
      copyCurrentRevisions(
        [{ sourceRevisionId, newRevisionId, newPageId: newId() }],
        duplicatingUserId,
        async () => {},
      ),
    ).rejects.toThrow();

    expect(
      await prisma.revisions.findUnique({ where: { id: newRevisionId } }),
    ).toMatchObject({
      pageId: occupiedPageId,
      body: 'existing body',
      authorId: sourceAuthorId,
    });
  });

  it('copies more entries than one chunk holds, recording progress before each chunk, and returns every copied id', async () => {
    const entryCount = REVISION_MERGE_CHUNK_SIZE + 2;
    const entries: RevisionCopyEntry[] = await Promise.all(
      Array.from({ length: entryCount }, async (_, i) => ({
        sourceRevisionId: await seedRevision({
          pageId: newId(),
          body: `chunk body ${i}`,
          authorId: sourceAuthorId,
        }),
        newRevisionId: newId(),
        newPageId: newId(),
      })),
    );
    track(...entries.flatMap((e) => [e.sourceRevisionId, e.newRevisionId]));
    const recordProgress = vi.fn(async () => {});

    const { copiedRevisionIds } = await copyCurrentRevisions(
      entries,
      duplicatingUserId,
      recordProgress,
    );

    expect(copiedRevisionIds).toEqual(
      new Set(entries.map((e) => e.newRevisionId)),
    );
    expect(recordProgress).toHaveBeenCalledTimes(2);
    const copies = await prisma.revisions.findMany({
      where: { id: { in: entries.map((e) => e.newRevisionId) } },
    });
    expect(new Map(copies.map((c) => [c.pageId, c.body]))).toEqual(
      new Map(entries.map((e, i) => [e.newPageId, `chunk body ${i}`])),
    );
  });

  it('leaves out of the result an entry whose source revision does not exist', async () => {
    const existingSourceId = await seedRevision({
      pageId: newId(),
      body: 'exists',
      authorId: sourceAuthorId,
    });
    const present: RevisionCopyEntry = {
      sourceRevisionId: existingSourceId,
      newRevisionId: newId(),
      newPageId: newId(),
    };
    const missing: RevisionCopyEntry = {
      sourceRevisionId: newId(),
      newRevisionId: newId(),
      newPageId: newId(),
    };
    track(existingSourceId, present.newRevisionId, missing.newRevisionId);

    const { copiedRevisionIds } = await copyCurrentRevisions(
      [present, missing],
      duplicatingUserId,
      async () => {},
    );

    expect(copiedRevisionIds).toEqual(new Set([present.newRevisionId]));
  });
});
