// prisma is the DB boundary: copyCurrentRevisions' contract with it is how
// many aggregations it sends, with which options, and what it reads back.
const { aggregateRaw, findMany } = vi.hoisted(() => ({
  aggregateRaw: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('~/utils/prisma', () => ({
  prisma: { revisions: { aggregateRaw, findMany } },
}));

import { Types } from 'mongoose';

import {
  buildCopyCurrentRevisionsPipeline,
  copyCurrentRevisions,
  MERGE_MAX_TIME_MS,
  REVISION_MERGE_CHUNK_SIZE,
  type RevisionCopyEntry,
} from './copy-current-revisions';

const newId = (): string => new Types.ObjectId().toHexString();

const makeEntries = (count: number): RevisionCopyEntry[] =>
  Array.from({ length: count }, () => ({
    sourceRevisionId: newId(),
    newRevisionId: newId(),
    newPageId: newId(),
  }));

const stageOf = (
  pipeline: readonly Record<string, unknown>[],
  operator: string,
): Record<string, unknown> => {
  const stage = pipeline.find((s) => operator in s);
  if (stage == null) {
    throw new Error(`no ${operator} stage in the pipeline`);
  }
  return stage;
};

const matchedSourceIdsOf = (pipeline: unknown): string[] => {
  if (!Array.isArray(pipeline)) {
    throw new Error('pipeline is not an array');
  }
  const match = stageOf(pipeline, '$match').$match;
  expect(match).toEqual({ _id: { $in: expect.any(Array) } });
  return (match as { _id: { $in: { $oid: string }[] } })._id.$in.map(
    (id) => id.$oid,
  );
};

describe('buildCopyCurrentRevisionsPipeline', () => {
  const authorId = newId();

  it('matches source revisions by revision id in extended JSON form, never by page id', () => {
    const entries = makeEntries(3);

    const pipeline = buildCopyCurrentRevisionsPipeline(entries, authorId);

    expect(stageOf(pipeline, '$match').$match).toEqual({
      _id: {
        $in: entries.map((e) => ({ $oid: e.sourceRevisionId })),
      },
    });
  });

  it('fixes the output document to exactly the seven revision fields', () => {
    const pipeline = buildCopyCurrentRevisionsPipeline(
      makeEntries(2),
      authorId,
    );

    const project = stageOf(pipeline, '$project').$project;
    expect(Object.keys(project as object).sort()).toEqual(
      ['__v', '_id', 'author', 'body', 'createdAt', 'format', 'pageId'].sort(),
    );
    expect(project).toMatchObject({
      author: { $literal: { $oid: authorId } },
      createdAt: '$$NOW',
      __v: { $literal: 0 },
      format: { $ifNull: ['$format', 'markdown'] },
    });
  });

  it('inserts into revisions and fails rather than overwrite an existing revision', () => {
    const pipeline = buildCopyCurrentRevisionsPipeline(
      makeEntries(1),
      authorId,
    );

    expect(pipeline.at(-1)).toEqual({
      $merge: {
        into: 'revisions',
        on: '_id',
        whenMatched: 'fail',
        whenNotMatched: 'insert',
      },
    });
  });
});

describe('copyCurrentRevisions', () => {
  const authorId = newId();

  beforeEach(() => {
    aggregateRaw.mockResolvedValue([]);
    findMany.mockResolvedValue([]);
  });

  it('runs one aggregation per chunk of entries, each with the time limit, after recording progress', async () => {
    const entries = makeEntries(REVISION_MERGE_CHUNK_SIZE * 2 + 5);
    const events: string[] = [];
    aggregateRaw.mockImplementation(() => {
      events.push('merge');
      return Promise.resolve([]);
    });
    const recordProgress = vi.fn(() => {
      events.push('progress');
      return Promise.resolve();
    });

    await copyCurrentRevisions(entries, authorId, recordProgress);

    expect(events).toEqual([
      'progress',
      'merge',
      'progress',
      'merge',
      'progress',
      'merge',
    ]);
    const calls = aggregateRaw.mock.calls.map(([args]) => args);
    for (const args of calls) {
      expect(args.options).toEqual({ maxTimeMS: MERGE_MAX_TIME_MS });
    }
    const chunks = calls.map((args) => matchedSourceIdsOf(args.pipeline));
    expect(chunks.map((ids) => ids.length)).toEqual([
      REVISION_MERGE_CHUNK_SIZE,
      REVISION_MERGE_CHUNK_SIZE,
      5,
    ]);
    expect(chunks.flat()).toEqual(entries.map((e) => e.sourceRevisionId));
  });

  it('does not run the aggregation of a chunk when recording progress before it fails', async () => {
    const entries = makeEntries(REVISION_MERGE_CHUNK_SIZE + 1);
    const lost = new Error('ownership lost');
    const recordProgress = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(lost);

    await expect(
      copyCurrentRevisions(entries, authorId, recordProgress),
    ).rejects.toBe(lost);

    expect(aggregateRaw).toHaveBeenCalledTimes(1);
  });

  it('returns the new revision ids that exist after the copy, reading back ids only', async () => {
    const entries = makeEntries(3);
    findMany.mockResolvedValue([
      { id: entries[0].newRevisionId },
      { id: entries[2].newRevisionId },
    ]);

    const { copiedRevisionIds } = await copyCurrentRevisions(
      entries,
      authorId,
      async () => {},
    );

    expect(copiedRevisionIds).toEqual(
      new Set([entries[0].newRevisionId, entries[2].newRevisionId]),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: entries.map((e) => e.newRevisionId) } },
      select: { id: true },
    });
  });
});
