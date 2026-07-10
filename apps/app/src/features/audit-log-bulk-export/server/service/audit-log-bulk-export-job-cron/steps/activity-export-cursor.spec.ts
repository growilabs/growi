import { mock } from 'vitest-mock-extended';

import type { PrismaClient } from '~/utils/prisma';

import { exportActivityCursor } from './activity-export-cursor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collects all yielded values from an async iterable into an array.
 */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

/**
 * Builds a minimal fake activities document.
 * The `id` field is the Prisma string ObjectId; `_id` is the Mongoose
 * backward-compat alias computed by utils/prisma but not needed in the
 * pure unit — only `id` matters for the cursor advance logic.
 */
function makeActivity(id: string, action = 'PAGE_CREATE') {
  return {
    id,
    v: 0,
    action,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    endpoint: '/api/v3/pages',
    event: null,
    eventModel: null,
    ip: '127.0.0.1',
    snapshot: { id: 'user-id', username: 'user' },
    target: null,
    targetModel: null,
    userId: 'user-id',
  };
}

// ---------------------------------------------------------------------------
// Tests — DB-free unit
// ---------------------------------------------------------------------------

describe('exportActivityCursor — DB-free unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Scenario 1: two full batches then empty terminator
  // -------------------------------------------------------------------------

  it('yields all docs across multiple batches in order and terminates on empty batch', async () => {
    const batchA = [makeActivity('id-001'), makeActivity('id-002')];
    const batchB = [makeActivity('id-003'), makeActivity('id-004')];
    const mockFindMany = vi
      .fn()
      .mockResolvedValueOnce(batchA)
      .mockResolvedValueOnce(batchB)
      .mockResolvedValueOnce([]); // empty → stop

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    const where = { action: { in: ['PAGE_CREATE'] } };
    const docs = await collect(exportActivityCursor(mockPrisma, where, 2));

    // All four docs yielded in insertion order
    expect(docs).toHaveLength(4);
    expect(docs[0].id).toBe('id-001');
    expect(docs[1].id).toBe('id-002');
    expect(docs[2].id).toBe('id-003');
    expect(docs[3].id).toBe('id-004');
  });

  // -------------------------------------------------------------------------
  // Scenario 2: id > lastId advances correctly between batches
  // -------------------------------------------------------------------------

  it('calls findMany with id.gt advancing to the last doc id of each batch', async () => {
    const batchA = [makeActivity('aaa'), makeActivity('bbb')];
    const batchB = [makeActivity('ccc')];
    const mockFindMany = vi
      .fn()
      .mockResolvedValueOnce(batchA)
      .mockResolvedValueOnce(batchB)
      .mockResolvedValueOnce([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    const where = { action: { in: ['PAGE_VIEW'] } };
    await collect(exportActivityCursor(mockPrisma, where, 10));

    // First call: no id.gt restriction (lastId undefined / initial)
    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ action: { in: ['PAGE_VIEW'] } }),
        orderBy: { id: 'asc' },
        take: 10,
      }),
    );

    // Second call: id.gt = last doc of first batch ('bbb')
    expect(mockFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ['PAGE_VIEW'] },
          id: { gt: 'bbb' },
        }),
        orderBy: { id: 'asc' },
        take: 10,
      }),
    );

    // Third call: id.gt = last doc of second batch ('ccc')
    expect(mockFindMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          action: { in: ['PAGE_VIEW'] },
          id: { gt: 'ccc' },
        }),
        orderBy: { id: 'asc' },
        take: 10,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 3: terminates immediately when first batch is empty
  // -------------------------------------------------------------------------

  it('terminates immediately and yields nothing when the first batch is empty', async () => {
    const mockFindMany = vi.fn().mockResolvedValueOnce([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    const docs = await collect(exportActivityCursor(mockPrisma, {}, 100));

    expect(docs).toHaveLength(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: single partial batch (fewer docs than batchSize)
  // -------------------------------------------------------------------------

  it('terminates after a partial batch (fewer docs than batchSize)', async () => {
    const batch = [makeActivity('x1'), makeActivity('x2'), makeActivity('x3')];
    const mockFindMany = vi
      .fn()
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([]); // second call returns empty

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    const docs = await collect(exportActivityCursor(mockPrisma, {}, 10));

    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.id)).toEqual(['x1', 'x2', 'x3']);
    // Two findMany calls: one with data, one empty terminator
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: batchSize is passed through to findMany take
  // -------------------------------------------------------------------------

  it('passes batchSize as the take argument to findMany', async () => {
    const mockFindMany = vi
      .fn()
      .mockResolvedValueOnce([makeActivity('y1')])
      .mockResolvedValueOnce([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    await collect(exportActivityCursor(mockPrisma, {}, 42));

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 42 }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 6: resume from startAfterId (lastExportedId semantics)
  // -------------------------------------------------------------------------

  it('resumes from startAfterId by including id.gt in the first findMany call', async () => {
    const batch = [makeActivity('resume-doc')];
    const mockFindMany = vi
      .fn()
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    await collect(exportActivityCursor(mockPrisma, {}, 10, 'previous-last-id'));

    // First call must already have id.gt = 'previous-last-id'
    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: 'previous-last-id' } }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Scenario 7: orderBy is always id asc
  // -------------------------------------------------------------------------

  it('always orders by id ascending regardless of where filter content', async () => {
    const mockFindMany = vi.fn().mockResolvedValueOnce([]);

    const mockPrisma = mock<PrismaClient>({
      activities: { findMany: mockFindMany },
    });

    await collect(
      exportActivityCursor(
        mockPrisma,
        { createdAt: { gte: new Date(), lt: new Date() } },
        5,
      ),
    );

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' } }),
    );
  });
});
