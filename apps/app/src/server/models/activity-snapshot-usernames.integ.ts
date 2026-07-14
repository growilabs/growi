/**
 * Integration tests — snapshot username autocomplete via Prisma extension (req 3.4).
 *
 * `prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount` is the
 * ActivityExtension method that replaces the Mongoose static of the same name.
 * It returns `{ usernames: string[], totalCount: number }` matching the observable
 * contract of the Mongoose implementation.
 *
 * These tests seed activities via `prisma.activities.createMany` (explicit `_id`
 * ObjectId strings — research R4) into the same per-worker test DB, then assert
 * the observable contracts:
 *
 *   - `usernames` contains distinct, regex-matched snapshot usernames (req 3.4).
 *   - `totalCount` reflects the total number of distinct matching usernames (req 3.4).
 *   - Ascending sort order (sortOpt: 1) is respected.
 *   - Descending sort order (sortOpt: -1) is respected.
 *   - Offset/limit pagination on the returned `usernames` slice works correctly.
 *   - The regex is case-insensitive ($options: 'i') — matches regardless of case.
 *   - `q` is escaped (escapeStringForMongoRegex) and anchored to a prefix (`^`):
 *     a pattern like 'ali' matches 'alice'/'Alice' (case-insensitive prefix)
 *     but NOT 'notalice' (no longer a substring match — this is the yuki-takei
 *     PR #11377 review fix, previously R6/scope-out).
 *   - Returns empty result when no usernames match the query.
 *   - Usernames are deduplicated: multiple activities with the same snapshot.username
 *     are counted/returned only once.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 3.4
 * Design: ActivityExtension.findSnapshotUsernamesByUsernameRegexWithTotalCount /
 *   .findSnapshotUsernamesByUsernameRegex; "ユーザー名補完同一 (req 3.4)".
 */

import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.72';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: {
  username: string;
  userId?: string;
  action?: string;
}) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: overrides.action ?? 'PAGE_CREATE',
    createdAt: new Date(),
    endpoint: '/test/snapshot-usernames',
    ip: TEST_IP,
    snapshot: {
      id: new Types.ObjectId().toHexString(),
      username: overrides.username,
    },
    userId: overrides.userId ?? new Types.ObjectId().toHexString(),
  };
}

describe('findSnapshotUsernamesByUsernameRegexWithTotalCount', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 3.4 — returns distinct matching usernames and correct totalCount', async () => {
    // Arrange: seed activities with various snapshot usernames
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'alice' }),
        makeActivityData({ username: 'alice' }), // duplicate — should count once
        makeActivityData({ username: 'alicia' }),
        makeActivityData({ username: 'bob' }),
      ],
    });

    // Act: query for usernames matching 'ali'
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'ali',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: only alice and alicia match 'ali'; both are distinct; bob is excluded
    expect(result.totalCount).toBe(2);
    expect(result.usernames).toHaveLength(2);
    expect(result.usernames).toContain('alice');
    expect(result.usernames).toContain('alicia');
    expect(result.usernames).not.toContain('bob');
  });

  it('req 3.4 — case-insensitive regex match ($options: i)', async () => {
    // Arrange: seed activities with mixed-case usernames
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'Charlie' }),
        makeActivityData({ username: 'charlie' }),
        makeActivityData({ username: 'CHARLIE' }),
        makeActivityData({ username: 'dave' }),
      ],
    });

    // Act: lowercase query should match all variants of 'charlie'
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'charlie',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: all three casing variants are distinct usernames; totalCount = 3
    expect(result.totalCount).toBe(3);
    expect(result.usernames).toHaveLength(3);
    expect(result.usernames).not.toContain('dave');
  });

  it('req 3.4 — ascending sort order (sortOpt: 1)', async () => {
    // Arrange: seed activities with usernames that have a clear alpha sort order
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'zara' }),
        makeActivityData({ username: 'alice' }),
        makeActivityData({ username: 'mike' }),
      ],
    });

    // Act: wildcard query (empty string matches all)
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        '',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: the returned usernames include alice, mike, zara; at minimum our
    // three are sorted ascending relative to each other.
    const returned = result.usernames;
    const aliceIdx = returned.indexOf('alice');
    const mikeIdx = returned.indexOf('mike');
    const zaraIdx = returned.indexOf('zara');

    expect(aliceIdx).toBeGreaterThanOrEqual(0);
    expect(mikeIdx).toBeGreaterThanOrEqual(0);
    expect(zaraIdx).toBeGreaterThanOrEqual(0);

    // ascending: alice < mike < zara
    expect(aliceIdx).toBeLessThan(mikeIdx);
    expect(mikeIdx).toBeLessThan(zaraIdx);
  });

  it('req 3.4 — descending sort order (sortOpt: -1)', async () => {
    // Arrange: seed activities with distinct usernames for a clear sort
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'anna' }),
        makeActivityData({ username: 'zoe' }),
        makeActivityData({ username: 'nina' }),
      ],
    });

    // Act: descending sort
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        '',
        { sortOpt: -1, offset: 0, limit: 10 },
      );

    const returned = result.usernames;
    const annaIdx = returned.indexOf('anna');
    const ninaIdx = returned.indexOf('nina');
    const zoeIdx = returned.indexOf('zoe');

    expect(annaIdx).toBeGreaterThanOrEqual(0);
    expect(ninaIdx).toBeGreaterThanOrEqual(0);
    expect(zoeIdx).toBeGreaterThanOrEqual(0);

    // descending: zoe > nina > anna
    expect(zoeIdx).toBeLessThan(ninaIdx);
    expect(ninaIdx).toBeLessThan(annaIdx);
  });

  it('req 3.4 — offset/limit pagination: returns the correct slice of results', async () => {
    // Arrange: seed 5 distinct usernames (u1 .. u5) that sort predictably
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'paginate_a' }),
        makeActivityData({ username: 'paginate_b' }),
        makeActivityData({ username: 'paginate_c' }),
        makeActivityData({ username: 'paginate_d' }),
        makeActivityData({ username: 'paginate_e' }),
      ],
    });

    // Act: query for 'paginate_' prefix (all 5 match); page 2 with limit 2
    const page2 =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'paginate_',
        { sortOpt: 1, offset: 2, limit: 2 },
      );

    // Assert: totalCount = 5 (full distinct count, unaffected by pagination);
    // usernames = the 2-element slice starting at offset 2 (paginate_c, paginate_d)
    expect(page2.totalCount).toBe(5);
    expect(page2.usernames).toHaveLength(2);
    expect(page2.usernames).toEqual(['paginate_c', 'paginate_d']);
  });

  it('req 3.4 — returns empty result when no username matches the query', async () => {
    // Arrange: seed activities with usernames that do NOT match 'xyz_nomatch'
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'user1' }),
        makeActivityData({ username: 'user2' }),
      ],
    });

    // Act: no matching query
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'xyz_nomatch_zzz',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: graceful empty response (no throw)
    expect(result.totalCount).toBe(0);
    expect(result.usernames).toHaveLength(0);
  });

  it('req 3.4 — duplicate activities with the same username count as one distinct username', async () => {
    // Arrange: 10 activities all from the same username
    const username = 'repeated_user';
    await prisma.activities.createMany({
      data: Array.from({ length: 10 }, () => makeActivityData({ username })),
    });

    // Act
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'repeated_user',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: totalCount = 1 (distinct); usernames = ['repeated_user']
    expect(result.totalCount).toBe(1);
    expect(result.usernames).toEqual(['repeated_user']);
  });

  it('matches only a prefix, not any substring (yuki-takei PR #11377 review fix)', async () => {
    // Arrange: 'notalice' contains 'ali' as a substring but does not start with it
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'alice' }),
        makeActivityData({ username: 'notalice' }),
      ],
    });

    // Act
    const result =
      await prisma.activities.findSnapshotUsernamesByUsernameRegexWithTotalCount(
        'ali',
        { sortOpt: 1, offset: 0, limit: 10 },
      );

    // Assert: prefix match only
    expect(result.usernames).toEqual(['alice']);
    expect(result.totalCount).toBe(1);
  });
});

describe('findSnapshotUsernamesByUsernameRegex', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('req 3.4 — returns distinct, case-insensitive prefix-matched usernames', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'Alice' }),
        makeActivityData({ username: 'Alice' }), // duplicate — should count once
        makeActivityData({ username: 'alicia' }),
        makeActivityData({ username: 'bob' }),
      ],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      'ali',
      { offset: 0, limit: 10 },
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(['Alice', 'alicia']));
    expect(result).not.toContain('bob');
  });

  it('matches only a prefix, not any substring', async () => {
    // Regression guard for the yuki-takei PR #11377 review fix: the previous
    // Prisma extension implementation matched 'ali' anywhere in the username.
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'alice' }),
        makeActivityData({ username: 'notalice' }),
      ],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      'ali',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['alice']);
  });

  it('treats regex metacharacters in q as literal text, not as regex syntax', async () => {
    // A username containing characters that are regex metacharacters
    // (escapeStringForMongoRegex must neutralize them, or this either throws
    // an invalid-regex error or silently matches far more than intended).
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'a.b' }),
        makeActivityData({ username: 'axb' }), // would match 'a.b' if '.' were a wildcard
      ],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      'a.b',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['a.b']);
  });

  it('returns [] when no username matches the query', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ username: 'user1' })],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      'xyz_nomatch_zzz',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
  });

  it.each([
    '',
    ' ',
    'a',
  ])('short-circuits to [] for q=%j even when a matching username exists (MIN_QUERY_LENGTH guard)', async (q) => {
    // A username that WOULD match every one of these queries if the guard
    // were absent (empty/whitespace/single-char all prefix-match 'a...').
    await prisma.activities.createMany({
      data: [makeActivityData({ username: 'aaaaaaaaaa' })],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      q,
      {
        offset: 0,
        limit: 10,
      },
    );

    expect(result).toEqual([]);
  });

  it('queries normally once q reaches MIN_QUERY_LENGTH (2 chars)', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ username: 'aaaaaaaaaa' })],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      'aa',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['aaaaaaaaaa']);
  });

  it('matches by prefix even with incidental surrounding whitespace in q', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ username: 'alice' }),
        makeActivityData({ username: 'notalice' }),
      ],
    });

    const result = await prisma.activities.findSnapshotUsernamesByUsernameRegex(
      '  ali  ',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['alice']);
  });
});
