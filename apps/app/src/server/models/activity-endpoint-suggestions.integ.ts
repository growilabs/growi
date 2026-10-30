/**
 * `prisma.activities.findEndpointsByEndpointRegex` — MongoDB fallback for the
 * `endpoint` auditlog suggestion field. Requires a real MongoDB connection.
 */

import { Types } from 'mongoose';

import { sanitizeEndpointForIndex } from '~/server/service/search-delegator/sanitize-endpoint-for-index';
import { prisma } from '~/utils/prisma';

const TEST_IP = '10.0.0.73';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: { endpoint: string }) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: 'PAGE_CREATE',
    createdAt: new Date(),
    endpoint: overrides.endpoint,
    ip: TEST_IP,
    // `snapshot` is a required composite (schema.prisma); this suite only
    // exercises the top-level `endpoint` field, so username is left unset.
    snapshot: { id: new Types.ObjectId().toHexString() },
    userId: new Types.ObjectId().toHexString(),
  };
}

describe('findEndpointsByEndpointRegex', () => {
  // Clears every row, not just this suite's: the assertions cover the whole
  // collection, and other integ files in the same worker DB leave activities
  // with `/_api/v3/...` endpoints behind.
  beforeEach(async () => {
    await prisma.activities.deleteMany({});
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({});
  });

  it('returns distinct, prefix-matched endpoints', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/v3/pages' }),
        makeActivityData({ endpoint: '/_api/v3/pages' }), // duplicate — should count once
        makeActivityData({ endpoint: '/_api/v3/pages/revert' }),
        makeActivityData({ endpoint: '/_api/v3/users' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/v3/pages',
      { offset: 0, limit: 10 },
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining(['/_api/v3/pages', '/_api/v3/pages/revert']),
    );
    expect(result).not.toContain('/_api/v3/users');
  });

  it('matches only a prefix, not any substring', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/v3/pages' }),
        makeActivityData({ endpoint: '/_api/v3/not-pages' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/v3/pages',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/_api/v3/pages']);
  });

  it('matches case-sensitively', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/v3/pages' }),
        makeActivityData({ endpoint: '/_API/v3/pages' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/v3/pages',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/_api/v3/pages']);
  });

  it('treats regex metacharacters in q as literal text, not as regex syntax', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/v3/a.b' }),
        makeActivityData({ endpoint: '/_api/v3/axb' }), // would match '/_api/v3/a.b' if '.' were a wildcard
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/v3/a.b',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/_api/v3/a.b']);
  });

  it('returns path-only endpoints, never exposing or splitting on the query string', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/search?q=secret-a' }),
        makeActivityData({ endpoint: '/_api/search?q=secret-b' }),
        makeActivityData({ endpoint: '/_api/search' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/search',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/_api/search']);
  });

  it('returns [] for a q that reaches into the query string, so a stored token cannot be probed by prefix', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/search?access_token=abc123' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/search?access_token=ab',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
  });

  it('groups by the same path that sanitizeEndpointForIndex indexes into ES', async () => {
    const seeded = [
      '/_api/v3/pages',
      '/_api/v3/pages?limit=10',
      '/_api/v3/pages/list?path=%2F&page=2',
      '/_api/v3/pages/rename?access_token=abc',
      '/_api/v3/pages?',
      '/_api/v3/users',
    ];
    await prisma.activities.createMany({
      data: seeded.map((endpoint) => makeActivityData({ endpoint })),
    });
    const q = '/_api/v3/pages';

    const result = await prisma.activities.findEndpointsByEndpointRegex(q, {
      offset: 0,
      limit: 10,
    });

    const expected = [
      ...new Set(
        seeded.map(sanitizeEndpointForIndex).filter((p) => p.startsWith(q)),
      ),
    ];
    expect(result).toHaveLength(expected.length);
    expect(result).toEqual(expect.arrayContaining(expected));
  });

  it('returns [] when no endpoint matches the query', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ endpoint: '/_api/v3/pages' })],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/xyz_nomatch_zzz',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
  });

  it('orders paths by hit count, then alphabetically, like the ES terms aggregation', async () => {
    await prisma.activities.createMany({
      data: [
        '/_api/v3/d',
        '/_api/v3/c',
        '/_api/v3/a',
        '/_api/v3/a?limit=10',
        '/_api/v3/b',
        '/_api/v3/b',
        '/_api/v3/b',
      ].map((endpoint) => makeActivityData({ endpoint })),
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/_api/v3/',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([
      '/_api/v3/b',
      '/_api/v3/a',
      '/_api/v3/c',
      '/_api/v3/d',
    ]);
  });

  it('matches by prefix even with incidental surrounding whitespace in q', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/_api/v3/pages' }),
        makeActivityData({ endpoint: '/_api/v3/not-pages' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '  /_api/v3/pages  ',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/_api/v3/pages']);
  });
});
