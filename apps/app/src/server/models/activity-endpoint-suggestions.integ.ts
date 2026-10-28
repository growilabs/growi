/**
 * `prisma.activities.findEndpointsByEndpointRegex` — MongoDB fallback for the
 * `endpoint` auditlog suggestion field. Requires a real MongoDB connection.
 */

import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.73';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: { endpoint: string; userId?: string }) {
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
    userId: overrides.userId ?? new Types.ObjectId().toHexString(),
  };
}

describe('findEndpointsByEndpointRegex', () => {
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('returns distinct, case-insensitive prefix-matched endpoints', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/api/v3/pages' }),
        makeActivityData({ endpoint: '/api/v3/pages' }), // duplicate — should count once
        makeActivityData({ endpoint: '/api/v3/pages/revert' }),
        makeActivityData({ endpoint: '/api/v3/users' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/api/v3/pages',
      { offset: 0, limit: 10 },
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining(['/api/v3/pages', '/api/v3/pages/revert']),
    );
    expect(result).not.toContain('/api/v3/users');
  });

  it('matches only a prefix, not any substring', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/api/v3/pages' }),
        makeActivityData({ endpoint: '/api/v3/not-pages' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/api/v3/pages',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/api/v3/pages']);
  });

  it('treats regex metacharacters in q as literal text, not as regex syntax', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/api/v3/a.b' }),
        makeActivityData({ endpoint: '/api/v3/axb' }), // would match '/api/v3/a.b' if '.' were a wildcard
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/api/v3/a.b',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/api/v3/a.b']);
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

  it('returns [] for a q that carries a query string, matching the path-only ES index', async () => {
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

  it('returns [] when no endpoint matches the query', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ endpoint: '/api/v3/pages' })],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '/xyz_nomatch_zzz',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
  });

  it.each([
    '',
    ' ',
    'a',
  ])('short-circuits to [] for q=%j even when a matching endpoint exists (minQueryLength guard)', async (q) => {
    await prisma.activities.createMany({
      data: [makeActivityData({ endpoint: 'aaaaaaaaaa' })],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(q, {
      offset: 0,
      limit: 10,
    });

    expect(result).toEqual([]);
  });

  it('short-circuits to [] for a "/" plus one character, since the leading "/" narrows nothing', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ endpoint: '/api/v3/pages' })],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex('/a', {
      offset: 0,
      limit: 10,
    });

    expect(result).toEqual([]);
  });

  it('matches by prefix even with incidental surrounding whitespace in q', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: '/api/v3/pages' }),
        makeActivityData({ endpoint: '/api/v3/not-pages' }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      '  /api/v3/pages  ',
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual(['/api/v3/pages']);
  });
});
