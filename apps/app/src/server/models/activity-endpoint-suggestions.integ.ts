/**
 * `prisma.activities.findEndpointsByEndpointRegex` — MongoDB fallback for the
 * `endpoint` auditlog suggestion field. Requires a real MongoDB connection.
 */

import { Types } from 'mongoose';

import { sanitizeEndpointForIndex } from '~/server/service/search-delegator/sanitize-endpoint-for-index';
import { prisma } from '~/utils/prisma';

const TEST_IP = '10.0.0.93';

// Every seeded endpoint and query lives under this prefix, so rows other integ
// files leave in the same worker DB never match.
const P = '/__endpoint-suggestions-integ';

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
  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('returns distinct, prefix-matched endpoints', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }),
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }), // duplicate — should count once
        makeActivityData({ endpoint: `${P}/_api/v3/pages/revert` }),
        makeActivityData({ endpoint: `${P}/_api/v3/users` }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/v3/pages`,
      { offset: 0, limit: 10 },
    );

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        `${P}/_api/v3/pages`,
        `${P}/_api/v3/pages/revert`,
      ]),
    );
    expect(result).not.toContain(`${P}/_api/v3/users`);
  });

  it('matches only a prefix, not any substring', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }),
        makeActivityData({ endpoint: `${P}/_api/v3/not-pages` }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/v3/pages`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([`${P}/_api/v3/pages`]);
  });

  it('matches case-sensitively', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }),
        makeActivityData({ endpoint: `${P}/_API/v3/pages` }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/v3/pages`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([`${P}/_api/v3/pages`]);
  });

  it('treats regex metacharacters in q as literal text, not as regex syntax', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/a.b` }),
        makeActivityData({ endpoint: `${P}/_api/v3/axb` }), // would match '.../a.b' if '.' were a wildcard
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/v3/a.b`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([`${P}/_api/v3/a.b`]);
  });

  it('returns path-only endpoints, never exposing or splitting on the query string', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/search?q=secret-a` }),
        makeActivityData({ endpoint: `${P}/_api/search?q=secret-b` }),
        makeActivityData({ endpoint: `${P}/_api/search` }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/search`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([`${P}/_api/search`]);
  });

  it('groups by the same path that sanitizeEndpointForIndex indexes into ES', async () => {
    const seeded = [
      `${P}/_api/v3/pages`,
      `${P}/_api/v3/pages?limit=10`,
      `${P}/_api/v3/pages/list?path=%2F&page=2`,
      `${P}/_api/v3/pages/rename?access_token=abc`,
      `${P}/_api/v3/pages?`,
      `${P}/_api/v3/users`,
    ];
    await prisma.activities.createMany({
      data: seeded.map((endpoint) => makeActivityData({ endpoint })),
    });
    const q = `${P}/_api/v3/pages`;

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
      data: [makeActivityData({ endpoint: `${P}/_api/v3/pages` })],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/xyz_nomatch_zzz`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([]);
  });

  it('orders paths by hit count, then alphabetically, like the ES terms aggregation', async () => {
    await prisma.activities.createMany({
      data: [
        `${P}/_api/v3/d`,
        `${P}/_api/v3/c`,
        `${P}/_api/v3/a`,
        `${P}/_api/v3/a?limit=10`,
        `${P}/_api/v3/b`,
        `${P}/_api/v3/b`,
        `${P}/_api/v3/b`,
      ].map((endpoint) => makeActivityData({ endpoint })),
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `${P}/_api/v3/`,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([
      `${P}/_api/v3/b`,
      `${P}/_api/v3/a`,
      `${P}/_api/v3/c`,
      `${P}/_api/v3/d`,
    ]);
  });

  it('matches by prefix even with incidental surrounding whitespace in q', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }),
        makeActivityData({ endpoint: `${P}/_api/v3/not-pages` }),
      ],
    });

    const result = await prisma.activities.findEndpointsByEndpointRegex(
      `  ${P}/_api/v3/pages  `,
      { offset: 0, limit: 10 },
    );

    expect(result).toEqual([`${P}/_api/v3/pages`]);
  });
});
