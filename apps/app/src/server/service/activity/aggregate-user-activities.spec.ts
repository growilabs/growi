import { mock } from 'vitest-mock-extended';

import type { IActivity } from '~/interfaces/activity';
import type { PrismaClient } from '~/utils/prisma';

import { aggregateUserActivities } from './aggregate-user-activities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fake $facet aggregateRaw result in Prisma EJSON format.
 *
 * Prisma aggregateRaw returns an array where each element is the $facet
 * document: [{ docs: [...], totalCount: [...] }].
 *
 * The EJSON values mirror what MongoDB/Prisma actually emits:
 *   - ObjectId fields → { "$oid": "<24-hex>" }
 *   - Date fields     → { "$date": "<ISO string>" }
 */
function makeRawFacetResult(opts: {
  docs: Array<{
    id: string;
    action: string;
    createdAt: string;
    userId: string;
    userName: string;
  }>;
  totalCount: number;
}) {
  const docs = opts.docs.map((d) => ({
    _id: { $oid: d.id },
    action: d.action,
    createdAt: { $date: d.createdAt },
    user: {
      _id: { $oid: d.userId },
      username: d.userName,
      name: d.userName,
      imageUrlCached: '/images/icons/user.svg',
    },
    target: null,
    targetModel: null,
  }));

  // The $count aggregation stage returns a plain integer in Prisma's EJSON output
  // (not a $numberInt wrapper), so we model the mock accordingly.
  const totalCount = opts.totalCount === 0 ? [] : [{ count: opts.totalCount }];

  // aggregateRaw returns an array (one element per $facet document)
  return [{ docs, totalCount }];
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DOC_ID_1 = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const DOC_ID_2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const USER_ID_1 = 'cccccccccccccccccccccccc';
const USER_ID_2 = 'dddddddddddddddddddddddd';
const ISO_DATE_1 = '2025-03-25T23:35:01.584Z';
const ISO_DATE_2 = '2025-03-26T10:00:00.000Z';

// Stub pipeline — the executor must pass it through unchanged to aggregateRaw.
// The pipeline contents are irrelevant to the executor's behavior.
const STUB_PIPELINE: Record<string, unknown>[] = [
  { $match: { user: 'stub' } },
  { $facet: { totalCount: [], docs: [] } },
];

// ---------------------------------------------------------------------------
// Tests — DB-free unit (aggregateRaw injected via mock)
// ---------------------------------------------------------------------------

describe('aggregateUserActivities — DB-free unit (injected pipeline + mock aggregateRaw)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path: multiple docs
  // -------------------------------------------------------------------------

  it('returns normalized docs with string _id and Date createdAt, and correct totalCount', async () => {
    // Arrange: mock prisma with known EJSON response
    const mockAggregateRaw = vi.fn().mockResolvedValue(
      makeRawFacetResult({
        docs: [
          {
            id: DOC_ID_1,
            action: 'PAGE_CREATE',
            createdAt: ISO_DATE_1,
            userId: USER_ID_1,
            userName: 'alice',
          },
          {
            id: DOC_ID_2,
            action: 'PAGE_UPDATE',
            createdAt: ISO_DATE_2,
            userId: USER_ID_2,
            userName: 'bob',
          },
        ],
        totalCount: 2,
      }),
    );

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    // Act
    const result = await aggregateUserActivities(mockPrisma, STUB_PIPELINE);

    // Assert: structure
    expect(result.totalCount).toBe(2);
    expect(result.docs).toHaveLength(2);

    // Assert: EJSON $oid → string
    const doc1 = result.docs[0] as IActivity & { _id: string };
    expect(typeof doc1._id).toBe('string');
    expect(doc1._id).toBe(DOC_ID_1);

    // Assert: EJSON $date → Date
    expect(doc1.createdAt).toBeInstanceOf(Date);
    expect(doc1.createdAt.toISOString()).toBe(ISO_DATE_1);

    // Assert: nested user _id is also normalized
    const user1 = (doc1 as Record<string, unknown>).user as Record<
      string,
      unknown
    >;
    expect(typeof user1._id).toBe('string');
    expect(user1._id).toBe(USER_ID_1);
  });

  // -------------------------------------------------------------------------
  // Happy path: docs with second document values
  // -------------------------------------------------------------------------

  it('normalizes all docs independently', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue(
      makeRawFacetResult({
        docs: [
          {
            id: DOC_ID_1,
            action: 'PAGE_CREATE',
            createdAt: ISO_DATE_1,
            userId: USER_ID_1,
            userName: 'alice',
          },
          {
            id: DOC_ID_2,
            action: 'PAGE_UPDATE',
            createdAt: ISO_DATE_2,
            userId: USER_ID_2,
            userName: 'bob',
          },
        ],
        totalCount: 5,
      }),
    );

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateUserActivities(mockPrisma, STUB_PIPELINE);

    expect(result.totalCount).toBe(5);

    const doc2 = result.docs[1] as IActivity & { _id: string };
    expect(doc2._id).toBe(DOC_ID_2);
    expect(doc2.createdAt).toBeInstanceOf(Date);
    expect(doc2.createdAt.toISOString()).toBe(ISO_DATE_2);
  });

  // -------------------------------------------------------------------------
  // Edge case: empty docs, totalCount = 0
  // -------------------------------------------------------------------------

  it('returns { docs: [], totalCount: 0 } when aggregateRaw returns empty facet', async () => {
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue(makeRawFacetResult({ docs: [], totalCount: 0 }));

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateUserActivities(mockPrisma, STUB_PIPELINE);

    expect(result.totalCount).toBe(0);
    expect(result.docs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Contract: the pipeline is passed through to aggregateRaw unchanged
  // -------------------------------------------------------------------------

  it('passes the caller-provided pipeline to aggregateRaw without modification', async () => {
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue(makeRawFacetResult({ docs: [], totalCount: 0 }));

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const customPipeline: Record<string, unknown>[] = [
      { $match: { user: 'custom' } },
    ];

    await aggregateUserActivities(mockPrisma, customPipeline);

    expect(mockAggregateRaw).toHaveBeenCalledWith({ pipeline: customPipeline });
  });

  // -------------------------------------------------------------------------
  // Edge case: totalCount array has one entry — value extracted as number
  // -------------------------------------------------------------------------

  it('extracts totalCount correctly from the first element of the totalCount array', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue(
      makeRawFacetResult({
        docs: [
          {
            id: DOC_ID_1,
            action: 'PAGE_CREATE',
            createdAt: ISO_DATE_1,
            userId: USER_ID_1,
            userName: 'alice',
          },
        ],
        totalCount: 42,
      }),
    );

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateUserActivities(mockPrisma, STUB_PIPELINE);

    expect(result.totalCount).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Regression: a structurally wrong aggregateRaw result must fail loudly,
  // not silently cast to { docs: IActivity[]; totalCount: number }
  // -------------------------------------------------------------------------

  it('throws when aggregateRaw does not return an array', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue({ unexpected: true });

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    await expect(
      aggregateUserActivities(mockPrisma, STUB_PIPELINE),
    ).rejects.toThrow(/array/i);
  });

  it('throws when the $facet document is missing (empty aggregateRaw array)', async () => {
    // Guards against re-introducing `normalized[0] ?? {}`, which silently
    // treated a missing $facet document (e.g. a broken pipeline that never
    // reaches the $facet stage) the same as a valid "zero activities" result.
    const mockAggregateRaw = vi.fn().mockResolvedValue([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    await expect(
      aggregateUserActivities(mockPrisma, STUB_PIPELINE),
    ).rejects.toThrow(/facet/i);
  });

  it('throws when the $facet document is missing a docs array', async () => {
    // Guards against re-introducing `(facetDoc.docs as unknown[]) ?? []`,
    // which silently treated a broken pipeline (wrong $facet key name) the
    // same as a valid "zero activities" result.
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue([{ totalCount: [{ count: 1 }] }]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    await expect(
      aggregateUserActivities(mockPrisma, STUB_PIPELINE),
    ).rejects.toThrow(/docs/i);
  });

  it('throws when totalCount[0].count is not a number', async () => {
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue([{ docs: [], totalCount: [{ count: 'oops' }] }]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    await expect(
      aggregateUserActivities(mockPrisma, STUB_PIPELINE),
    ).rejects.toThrow(/count/i);
  });
});
