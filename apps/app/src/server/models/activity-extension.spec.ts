/**
 * Unit tests for ActivityExtension.
 *
 * Observable contracts under test:
 * 1. normalizeToId (pure helper): object → ID string, string → unchanged,
 *    null/undefined pass through.
 * 2. extension export: is a Prisma.defineExtension result (function).
 * 3. createByParameters: builds the correct Prisma `create` data — mapping
 *    user→userId, target→target (normalized to ID strings), injecting the
 *    Mongoose-compat defaults (v:0, createdAt, snapshot.id, ip/endpoint '').
 * 4. updateByParameters: calls context.update with correct args (including
 *    include:{user:true}); returns null on P2025; re-throws on other errors.
 *
 * DB-free: a real extended Prisma client is built, but `activities.create` /
 * `activities.update` are spied/mocked so no connection is opened.
 */
import { Prisma, PrismaClient } from '~/generated/prisma/client';

import { extension, normalizeToId } from './activity';

describe('normalizeToId (pure helper)', () => {
  it('passes an ID string through unchanged', () => {
    expect(normalizeToId('507f1f77bcf86cd799439011')).toBe(
      '507f1f77bcf86cd799439011',
    );
  });

  it('extracts _id from an object with a string _id', () => {
    expect(
      normalizeToId({ _id: '507f1f77bcf86cd799439011', username: 'alice' }),
    ).toBe('507f1f77bcf86cd799439011');
  });

  it('calls toString() on a non-string _id (ObjectId-like)', () => {
    const objectId = { toString: () => '507f1f77bcf86cd799439011' };
    const userObj = { _id: objectId, username: 'alice' };
    expect(normalizeToId(userObj)).toBe('507f1f77bcf86cd799439011');
  });

  it('falls back to .id when ._id is absent', () => {
    expect(
      normalizeToId({ id: '507f1f77bcf86cd799439022', username: 'bob' }),
    ).toBe('507f1f77bcf86cd799439022');
  });

  it('returns undefined when value is undefined', () => {
    expect(normalizeToId(undefined)).toBeUndefined();
  });

  it('returns null when value is null', () => {
    expect(normalizeToId(null)).toBeNull();
  });
});

describe('extension export', () => {
  it('is a function (Prisma.defineExtension result)', () => {
    expect(extension).toBeDefined();
    expect(typeof extension).toBe('function');
  });
});

describe('ActivityExtension.createByParameters - data-building contract', () => {
  /**
   * Build a real extended client and spy on the underlying `activities.create`
   * so the call is intercepted before any DB I/O. createByParameters obtains
   * its context via Prisma.getExtensionContext(this), which resolves to this
   * same (spied) delegate, so the spy captures exactly what the method builds.
   */
  const buildClient = () => {
    const base = new PrismaClient({
      datasourceUrl: 'mongodb://localhost:27017/test',
    });
    const client = base.$extends(extension);
    // A full, valid activities row to return from the mocked create.
    const returnedRow = {
      _id: 'created-id',
      __v: 0,
      id: 'created-id',
      v: 0,
      action: 'PAGE_VIEW',
      createdAt: new Date(),
      endpoint: '',
      event: null,
      eventModel: null,
      ip: '',
      target: null,
      targetModel: null,
      userId: null,
      // Prisma materializes absent optional composite fields as null
      snapshot: {
        id: 'snap-id',
        username: '',
        originalName: null,
        pagePath: null,
        pageId: null,
        fileSize: null,
      },
    };
    const createSpy = vi
      .spyOn(client.activities, 'create')
      .mockResolvedValue(returnedRow);
    return { client, createSpy };
  };

  it('maps an object user/target to ID strings and injects Mongoose-compat defaults', async () => {
    // Arrange
    const { client, createSpy } = buildClient();
    const userObj = { _id: '507f1f77bcf86cd799439011', username: 'alice' };
    const pageObj = { _id: '507f1f77bcf86cd799439033', path: '/test' };

    // Act
    await client.activities.createByParameters({
      user: userObj,
      target: pageObj,
      targetModel: 'Page',
      action: 'PAGE_VIEW',
      snapshot: { username: 'alice' },
    });

    // Assert: create received normalized string IDs + defaults
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: '507f1f77bcf86cd799439011',
        target: '507f1f77bcf86cd799439033',
        targetModel: 'Page',
        action: 'PAGE_VIEW',
        v: 0,
        ip: '',
        endpoint: '',
      }),
    });

    // snapshot.id is a non-empty generated string; createdAt is a Date
    const data = createSpy.mock.calls[0]?.[0]?.data;
    expect(data).toBeDefined();
    const callData = data as {
      snapshot: { id: string; username: string };
      createdAt: Date;
    };
    expect(typeof callData.snapshot.id).toBe('string');
    expect(callData.snapshot.id.length).toBeGreaterThan(0);
    expect(callData.snapshot.username).toBe('alice');
    expect(callData.createdAt).toBeInstanceOf(Date);
  });

  it('passes ID strings through to create unchanged (the common caller path)', async () => {
    // Arrange: add-activity.ts passes req.user?._id (a bare ID), no target
    const { client, createSpy } = buildClient();

    // Act
    await client.activities.createByParameters({
      ip: '127.0.0.1',
      endpoint: '/_api/v3/pages',
      action: 'PAGE_CREATE',
      user: '507f1f77bcf86cd799439011',
      snapshot: { username: 'bob' },
    });

    // Assert: string ID passes through; explicit ip/endpoint preserved
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: '507f1f77bcf86cd799439011',
        ip: '127.0.0.1',
        endpoint: '/_api/v3/pages',
        action: 'PAGE_CREATE',
        v: 0,
      }),
    });
  });

  it('omits userId/target when user/target are absent', async () => {
    // Arrange: some callers (e.g. system actions) pass no user/target
    const { client, createSpy } = buildClient();

    // Act
    await client.activities.createByParameters({
      ip: '127.0.0.1',
      endpoint: '/_api/v3/admin',
      action: 'ADMIN_APP_SETTING_UPDATE',
      snapshot: {},
    });

    // Assert: userId and target are undefined (not objects, not null-bearing)
    const data = createSpy.mock.calls[0]?.[0]?.data as {
      userId?: string;
      target?: string;
    };
    expect(data.userId).toBeUndefined();
    expect(data.target).toBeUndefined();
  });
});

describe('ActivityExtension.updateByParameters - not-found semantics (C1)', () => {
  /**
   * Build a real extended client and spy on `activities.update` so no DB I/O
   * occurs. updateByParameters must:
   *   - call update({ where: { id }, data: parameters, include: { user: true } })
   *   - return the updated document on success
   *   - return null (not throw) when Prisma throws P2025
   *   - re-throw any other error
   *
   * Design ref: design.md "ActivityExtension Postconditions (C1)", "Error Handling",
   * "Key Decision 5". Requirements: 1.2, 5.3.
   */

  // A full, valid activities row (with populated user) returned from mocked update.
  const populatedRow = {
    _id: 'activity-id-1',
    __v: 0,
    id: 'activity-id-1',
    v: 0,
    action: 'PAGE_CREATE',
    createdAt: new Date(),
    endpoint: '/_api/v3/pages',
    event: null,
    eventModel: null,
    ip: '127.0.0.1',
    target: null,
    targetModel: null,
    userId: 'user-id-1',
    // Prisma materializes absent optional composite fields as null
    snapshot: {
      id: 'snap-id',
      username: 'alice',
      originalName: null,
      pagePath: null,
      pageId: null,
      fileSize: null,
    },
    user: { id: 'user-id-1', username: 'alice' },
  };

  const buildUpdateClient = () => {
    const base = new PrismaClient({
      datasourceUrl: 'mongodb://localhost:27017/test',
    });
    const client = base.$extends(extension);
    const updateSpy = vi
      .spyOn(client.activities, 'update')
      .mockResolvedValue(populatedRow);
    return { client, updateSpy };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls update with correct where/data/include and returns the populated result', async () => {
    // Arrange
    const { client, updateSpy } = buildUpdateClient();
    const activityId = 'activity-id-1';
    const parameters = { action: 'PAGE_VIEW' };

    // Act
    const result = await client.activities.updateByParameters(
      activityId,
      parameters,
    );

    // Assert: update called with exact args (Key Decision 5: include user)
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: activityId },
      data: parameters,
      include: { user: true },
    });

    // Assert: populated row is returned unchanged
    expect(result).toEqual(populatedRow);
  });

  it('normalizes a Document/ObjectId-like `target` to an ID string (regression: update-page.ts passes the full updated Page document, relying on the auto-cast Mongoose findOneAndUpdate used to perform)', async () => {
    // Arrange
    const { client, updateSpy } = buildUpdateClient();
    const pageDocument = {
      _id: { toString: () => '507f1f77bcf86cd799439033' },
      path: '/some/page',
    };

    // Act
    await client.activities.updateByParameters('activity-id-1', {
      action: 'PAGE_UPDATE',
      target: pageDocument as never,
    });

    // Assert: the Document was normalized to a bare ID string before reaching
    // Prisma's update() -- Prisma has no Mongoose-style auto-cast and fails to
    // serialize a Document/ObjectId value passed as-is.
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'activity-id-1' },
      data: { action: 'PAGE_UPDATE', target: '507f1f77bcf86cd799439033' },
      include: { user: true },
    });
  });

  it('normalizes a bare ObjectId instance passed for `target`/`event` to an ID string', async () => {
    // Arrange
    const { client, updateSpy } = buildUpdateClient();
    const objectId = { toString: () => '507f1f77bcf86cd799439044' };

    // Act
    await client.activities.updateByParameters('activity-id-1', {
      action: 'PAGE_REVERT',
      target: objectId as never,
      event: objectId as never,
    });

    // Assert
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'activity-id-1' },
      data: {
        action: 'PAGE_REVERT',
        target: '507f1f77bcf86cd799439044',
        event: '507f1f77bcf86cd799439044',
      },
      include: { user: true },
    });
  });

  it('passes a Prisma field-update-operation object (`{ set: ... }`) through unchanged', async () => {
    // Arrange
    const { client, updateSpy } = buildUpdateClient();

    // Act
    await client.activities.updateByParameters('activity-id-1', {
      action: 'PAGE_UPDATE',
      target: { set: '507f1f77bcf86cd799439055' },
    });

    // Assert: an already-valid Prisma update-operation input is not
    // mistaken for a loose Document and re-wrapped/mangled.
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'activity-id-1' },
      data: {
        action: 'PAGE_UPDATE',
        target: { set: '507f1f77bcf86cd799439055' },
      },
      include: { user: true },
    });
  });

  it('passes string/null/undefined target/event/userId through unchanged', async () => {
    // Arrange
    const { client, updateSpy } = buildUpdateClient();

    // Act: target absent (undefined), event explicitly null
    await client.activities.updateByParameters('activity-id-1', {
      action: 'PAGE_UPDATE',
      userId: '507f1f77bcf86cd799439066',
      event: null,
    });

    // Assert
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'activity-id-1' },
      data: {
        action: 'PAGE_UPDATE',
        userId: '507f1f77bcf86cd799439066',
        target: undefined,
        event: null,
      },
      include: { user: true },
    });
  });

  it('returns null (does NOT throw) when Prisma throws P2025 (record not found, C1)', async () => {
    // Arrange: simulate Prisma "Record to update not found" error
    const { client, updateSpy } = buildUpdateClient();
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      'Record to update not found.',
      { code: 'P2025', clientVersion: 'test' },
    );
    updateSpy.mockRejectedValue(p2025);

    // Act
    const result = await client.activities.updateByParameters('missing-id', {
      action: 'PAGE_VIEW',
    });

    // Assert: null returned, not thrown (preserves findOneAndUpdate null semantics)
    expect(result).toBeNull();
  });

  it('re-throws errors other than P2025 (non-P2025 errors must not be swallowed)', async () => {
    // Arrange: simulate a non-P2025 known error (e.g. unique constraint P2002)
    const { client, updateSpy } = buildUpdateClient();
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed.',
      { code: 'P2002', clientVersion: 'test' },
    );
    updateSpy.mockRejectedValue(p2002);

    // Act & Assert: the error propagates (not swallowed to null)
    await expect(
      client.activities.updateByParameters('activity-id-1', {
        action: 'PAGE_VIEW',
      }),
    ).rejects.toThrow('Unique constraint failed.');
  });
});

describe('ActivityExtension.findSnapshotUsernamesByUsernameRegexWithTotalCount', () => {
  /**
   * Build a real extended client and spy on `activities.aggregateRaw` so no DB
   * I/O occurs.
   *
   * The method makes two aggregateRaw calls:
   *   1st: usernames pipeline → returns grouped rows [{ _id: 'alice' }, ...]
   *   2nd: totalCount pipeline → returns [{ total: N }]
   *
   * Contract under test (design.md ActivityExtension Contracts, req 3.4):
   *   - Returns { usernames: string[], totalCount: number }
   *   - Usernames pipeline stages in order: $match(regex), $group, $sort, $skip, $limit
   *     (unbounded — no cap before $match; maxTimeMS bounds runtime instead)
   *   - TotalCount pipeline: $match(regex), $group, $count('total') → distinct count
   *   - `q` is escaped (escapeStringForMongoRegex) and anchored to a prefix (`^`)
   *   - Both aggregateRaw calls pass `options: { maxTimeMS: 5000 }`
   *   - Empty aggregateRaw results → { usernames: [], totalCount: 0 }
   *   - No MIN_QUERY_LENGTH short-circuit — an empty `q` legitimately matches
   *     every username for the `/usernames` admin listing caller
   */
  const buildAggregateClient = () => {
    const base = new PrismaClient({
      datasourceUrl: 'mongodb://localhost:27017/test',
    });
    const client = base.$extends(extension);
    const aggregateRawSpy = vi.spyOn(client.activities, 'aggregateRaw');
    return { client, aggregateRawSpy };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns usernames and totalCount from two aggregateRaw calls', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    // 1st call: usernames pipeline result
    aggregateRawSpy.mockResolvedValueOnce([
      { _id: 'alice' },
      { _id: 'bob' },
    ] as never);
    // 2nd call: totalCount pipeline result
    aggregateRawSpy.mockResolvedValueOnce([{ total: 5 }] as never);

    // Act
    const result =
      await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'ali',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: observable return value
    expect(result).toEqual({ usernames: ['alice', 'bob'], totalCount: 5 });
  });

  it('usernames pipeline contains correct stages in order with an escaped, prefix-anchored regex', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([{ _id: 'charlie' }] as never);
    aggregateRawSpy.mockResolvedValueOnce([{ total: 1 }] as never);
    const rawQ = 'char.*[special';

    // Act
    await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
      rawQ,
      { sortOpt: -1, offset: 5, limit: 20 },
    );

    // Assert: first aggregateRaw call = usernames pipeline
    expect(aggregateRawSpy).toHaveBeenCalledTimes(2);
    const firstCallArgs = aggregateRawSpy.mock.calls[0]?.[0] as {
      pipeline: unknown[];
      options: { maxTimeMS: number };
    };
    expect(firstCallArgs).toBeDefined();
    const pipeline = firstCallArgs.pipeline;
    expect(pipeline).toHaveLength(5);
    // Stage 0: $match, regex metacharacters escaped and anchored to a prefix
    expect(pipeline[0]).toEqual({
      $match: {
        'snapshot.username': {
          $regex: '^char\\.\\*\\[special',
          $options: 'i',
        },
      },
    });
    // Stage 1: $group by snapshot.username
    expect(pipeline[1]).toEqual({ $group: { _id: '$snapshot.username' } });
    // Stage 2: $sort with provided sortOpt
    expect(pipeline[2]).toEqual({ $sort: { _id: -1 } });
    // Stage 3: $skip with provided offset
    expect(pipeline[3]).toEqual({ $skip: 5 });
    // Stage 4: $limit with provided limit
    expect(pipeline[4]).toEqual({ $limit: 20 });
    // Runtime is bounded instead of a pre-match row cap
    expect(firstCallArgs.options).toEqual({ maxTimeMS: 5000 });
  });

  it('totalCount pipeline uses $match, $group, $count to reproduce distinct count', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([{ _id: 'dave' }] as never);
    aggregateRawSpy.mockResolvedValueOnce([{ total: 42 }] as never);

    // Act
    await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
      'dave',
      { sortOpt: 1, offset: 0, limit: 10 },
    );

    // Assert: second aggregateRaw call = totalCount pipeline
    const secondCallArgs = aggregateRawSpy.mock.calls[1]?.[0] as {
      pipeline: unknown[];
      options: { maxTimeMS: number };
    };
    expect(secondCallArgs).toBeDefined();
    const totalPipeline = secondCallArgs.pipeline;
    expect(totalPipeline).toHaveLength(3);
    expect(totalPipeline[0]).toEqual({
      $match: { 'snapshot.username': { $regex: '^dave', $options: 'i' } },
    });
    expect(totalPipeline[1]).toEqual({ $group: { _id: '$snapshot.username' } });
    expect(totalPipeline[2]).toEqual({ $count: 'total' });
    expect(secondCallArgs.options).toEqual({ maxTimeMS: 5000 });
    await expect(aggregateRawSpy.mock.results[1]?.value).resolves.toEqual([
      { total: 42 },
    ]);
  });

  it('returns empty usernames and totalCount 0 when aggregateRaw returns empty arrays', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([] as never);
    aggregateRawSpy.mockResolvedValueOnce([] as never);

    // Act
    const result =
      await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'nomatch',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: graceful empty result
    expect(result).toEqual({ usernames: [], totalCount: 0 });
  });

  it('does not short-circuit an empty q — matches every username for the admin listing caller', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([{ _id: 'alice' }] as never);
    aggregateRawSpy.mockResolvedValueOnce([{ total: 1 }] as never);

    // Act
    const result =
      await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        '',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: aggregateRaw was actually invoked (no short-circuit), unlike the
    // plain findSnapshotUsernamesByUsernameRegex variant below
    expect(aggregateRawSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ usernames: ['alice'], totalCount: 1 });
  });

  it('applies defaults (sortOpt=1, offset=0, limit=10) when options values are falsy', async () => {
    // Arrange
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([] as never);
    aggregateRawSpy.mockResolvedValueOnce([] as never);

    // Act — pass 0/0/0 so all || fallbacks trigger
    await client.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
      'q',
      { sortOpt: 0 as unknown as 1 | -1, offset: 0, limit: 0 },
    );

    const firstCallArgs = aggregateRawSpy.mock.calls[0]?.[0] as {
      pipeline: unknown[];
    };
    const pipeline = firstCallArgs.pipeline;
    // Default sortOpt = 1
    expect(pipeline[2]).toEqual({ $sort: { _id: 1 } });
    // Default limit = 10
    expect(pipeline[4]).toEqual({ $limit: 10 });
    // offset = 0 (the || default is also 0, so same result)
    expect(pipeline[3]).toEqual({ $skip: 0 });
  });
});

describe('ActivityExtension.findSnapshotUsernamesByUsernameRegex', () => {
  /**
   * Plain (no total count) variant used by the MongoDB fallback path
   * (SearchService.searchAuditlogUsernames — invoked only when Elasticsearch
   * is unreachable/unconfigured). Same $match/$group shape as the
   * WithTotalCount variant's usernames pipeline, but additionally
   * short-circuits below MIN_QUERY_LENGTH so a whitespace/single-char query
   * never reaches MongoDB (design.md; req 3.4).
   */
  const buildAggregateClient = () => {
    const base = new PrismaClient({
      datasourceUrl: 'mongodb://localhost:27017/test',
    });
    const client = base.$extends(extension);
    const aggregateRawSpy = vi.spyOn(client.activities, 'aggregateRaw');
    return { client, aggregateRawSpy };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns usernames from a single aggregateRaw call', async () => {
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([
      { _id: 'alice' },
      { _id: 'bob' },
    ] as never);

    const result = await client.activities.findSnapshotUsernamesByUsernameRegex(
      'al',
      { offset: 0, limit: 10 },
    );

    expect(aggregateRawSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['alice', 'bob']);
  });

  it('pipeline uses an escaped, prefix-anchored regex and bounds runtime via maxTimeMS', async () => {
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([] as never);

    await client.activities.findSnapshotUsernamesByUsernameRegex('a.b', {
      offset: 3,
      limit: 15,
    });

    const callArgs = aggregateRawSpy.mock.calls[0]?.[0] as {
      pipeline: unknown[];
      options: { maxTimeMS: number };
    };
    expect(callArgs.pipeline).toEqual([
      {
        $match: {
          'snapshot.username': { $regex: '^a\\.b', $options: 'i' },
        },
      },
      { $group: { _id: '$snapshot.username' } },
      { $sort: { _id: 1 } },
      { $skip: 3 },
      { $limit: 15 },
    ]);
    expect(callArgs.options).toEqual({ maxTimeMS: 5000 });
  });

  it.each([
    '',
    ' ',
    'a',
  ])('short-circuits to [] without querying MongoDB when q=%j (below MIN_QUERY_LENGTH)', async (q) => {
    const { client, aggregateRawSpy } = buildAggregateClient();

    const result = await client.activities.findSnapshotUsernamesByUsernameRegex(
      q,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
    expect(aggregateRawSpy).not.toHaveBeenCalled();
  });

  it('queries MongoDB once q reaches MIN_QUERY_LENGTH (2 chars)', async () => {
    const { client, aggregateRawSpy } = buildAggregateClient();
    aggregateRawSpy.mockResolvedValueOnce([{ _id: 'al' }] as never);

    const result = await client.activities.findSnapshotUsernamesByUsernameRegex(
      'al',
      { offset: 0, limit: 10 },
    );

    expect(aggregateRawSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['al']);
  });
});
