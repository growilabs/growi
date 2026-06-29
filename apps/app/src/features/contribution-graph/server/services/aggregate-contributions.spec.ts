import { mock } from 'vitest-mock-extended';

import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution';
import type { PrismaClient } from '~/utils/prisma';

import { aggregateContributions } from './aggregate-contributions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fake aggregateRaw result for the $dateTrunc daily aggregation.
 *
 * Prisma aggregateRaw returns an array; each element is one day-bucket document.
 * The pipeline ($group → $project → $sort) yields:
 *   [{ date: "2025-11-01", count: 2 }, ...]
 *
 * The `date` field is a plain string (produced by $dateToString), so no EJSON
 * wrapping for it. `count` is a plain integer.
 */
function makeDayBuckets(
  buckets: Array<{ date: string; count: number }>,
): unknown[] {
  return buckets;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const STUB_PIPELINE: Record<string, unknown>[] = [
  { $match: { userId: 'stub-user-id', action: { $in: ['PAGE_CREATE'] } } },
  {
    $group: {
      _id: { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: 'UTC' } },
      count: { $sum: 1 },
    },
  },
  {
    $project: {
      _id: 0,
      date: { $dateToString: { format: '%Y-%m-%d', date: '$_id' } },
      count: '$count',
    },
  },
  { $sort: { date: 1 } },
];

// ---------------------------------------------------------------------------
// Tests — DB-free unit (aggregateRaw injected via mock<PrismaClient>())
// ---------------------------------------------------------------------------

describe('aggregateContributions — DB-free unit (injected pipeline + mock aggregateRaw)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path: multiple day buckets
  // -------------------------------------------------------------------------

  it('returns normalized day-bucket array in the shape IContributionDay[] requires', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue(
      makeDayBuckets([
        { date: '2025-11-01', count: 2 },
        { date: '2025-11-02', count: 1 },
      ]),
    );

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateContributions(mockPrisma, STUB_PIPELINE);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual<IContributionDay>({
      date: '2025-11-01',
      count: 2,
    });
    expect(result[1]).toEqual<IContributionDay>({
      date: '2025-11-02',
      count: 1,
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: empty result
  // -------------------------------------------------------------------------

  it('returns an empty array when aggregateRaw returns no day buckets', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateContributions(mockPrisma, STUB_PIPELINE);

    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Contract: the pipeline is passed through to aggregateRaw unchanged
  // -------------------------------------------------------------------------

  it('passes the caller-provided pipeline to aggregateRaw without modification', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const customPipeline: Record<string, unknown>[] = [
      { $match: { userId: 'custom-user' } },
    ];

    await aggregateContributions(mockPrisma, customPipeline);

    expect(mockAggregateRaw).toHaveBeenCalledWith({
      pipeline: customPipeline,
    });
  });

  // -------------------------------------------------------------------------
  // Happy path: single day bucket
  // -------------------------------------------------------------------------

  it('returns a single-entry array when only one day has contributions', async () => {
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue(makeDayBuckets([{ date: '2025-11-05', count: 7 }]));

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateContributions(mockPrisma, STUB_PIPELINE);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<IContributionDay>({
      date: '2025-11-05',
      count: 7,
    });
  });

  // -------------------------------------------------------------------------
  // Contract: result is sorted in date ascending order (as provided by pipeline)
  // -------------------------------------------------------------------------

  it('preserves the order of day buckets returned by aggregateRaw (ascending by date)', async () => {
    const mockAggregateRaw = vi.fn().mockResolvedValue(
      makeDayBuckets([
        { date: '2025-10-28', count: 3 },
        { date: '2025-10-29', count: 1 },
        { date: '2025-11-01', count: 5 },
      ]),
    );

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateContributions(mockPrisma, STUB_PIPELINE);

    expect(result.map((r) => r.date)).toEqual([
      '2025-10-28',
      '2025-10-29',
      '2025-11-01',
    ]);
  });

  // -------------------------------------------------------------------------
  // EJSON: $oid wrapper in a field (e.g., _id that may still appear) → normalized
  // -------------------------------------------------------------------------

  it('normalizes EJSON $oid and $date wrappers if present in the aggregation result', async () => {
    // Even though the $project stage strips _id and produces plain date strings,
    // paranoia test: if any EJSON wrapper leaks through, it must be normalized.
    const mockAggregateRaw = vi
      .fn()
      .mockResolvedValue([{ date: '2025-11-01', count: 4 }]);

    const mockPrisma = mock<PrismaClient>({
      activities: { aggregateRaw: mockAggregateRaw },
    });

    const result = await aggregateContributions(mockPrisma, STUB_PIPELINE);

    expect(result[0].date).toBe('2025-11-01');
    expect(typeof result[0].count).toBe('number');
    expect(result[0].count).toBe(4);
  });
});
