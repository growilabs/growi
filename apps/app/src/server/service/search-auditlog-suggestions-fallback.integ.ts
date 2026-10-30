/**
 * searchAuditlogSuggestions must reach the real Prisma MongoDB fallback when
 * Elasticsearch is unreachable (search.spec.ts mocks `~/utils/prisma`).
 */

import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { prisma } from '~/utils/prisma';

import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

// Minimal User schema (the username handler reads username/status). Guarded
// against duplicate registration across specs in the same process -- see
// external-account.integ.ts for the same pattern.
if (mongoose.models.User == null) {
  mongoose.model(
    'User',
    new mongoose.Schema({ username: String, status: Number }),
  );
}

class UnreachableSearchService extends SearchService {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base ctor (factory pattern) so the test can instantiate it
  public constructor() {
    super();
  }

  override get isConfigured(): boolean {
    return false;
  }
}

const TEST_IP = '10.0.0.90';

// Every seeded endpoint and query lives under this prefix, so rows other integ
// files leave in the same worker DB never match.
const P = '/__auditlog-suggestions-fallback-integ';

function makeActivityData(overrides: { username?: string; endpoint?: string }) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: 'PAGE_CREATE',
    createdAt: new Date(),
    endpoint: overrides.endpoint ?? `${P}/_api/v3/pages`,
    ip: TEST_IP,
    snapshot: {
      id: new Types.ObjectId().toHexString(),
      username: overrides.username,
    },
    userId: new Types.ObjectId().toHexString(),
  };
}

describe('SearchService.searchAuditlogSuggestions() MongoDB fallback (real Prisma)', () => {
  let searchService: UnreachableSearchService;

  beforeEach(async () => {
    searchService = new UnreachableSearchService();
    searchService.fullTextSearchDelegator = mock<ElasticsearchDelegator>();
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  it('resolves username suggestions through the real Prisma extension', async () => {
    await prisma.activities.createMany({
      data: [makeActivityData({ username: 'alice' })],
    });

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    // No User document was seeded, so the real classification query finds no
    // live match — the observable contract is that it still surfaces the
    // name (as inactive), not that it throws.
    expect(result.username?.inactiveUsernames).toContain('alice');
  });

  it('resolves endpoint suggestions through the real Prisma extension', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/v3/pages` }),
        makeActivityData({ endpoint: `${P}/_api/v3/users` }),
      ],
    });

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      `${P}/_api/v3/p`,
      10,
    );

    expect(result.endpoint?.endpoints).toEqual([`${P}/_api/v3/pages`]);
  });

  it('answers a pasted URL by its path alone, whether or not its query string prefixes a stored token', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({ endpoint: `${P}/_api/search?access_token=abc123` }),
      ],
    });

    const search = (q: string) =>
      searchService.searchAuditlogSuggestions(['endpoint'], q, 10);
    const expected = { endpoint: { endpoints: [`${P}/_api/search`] } };

    expect(await search(`${P}/_api/search?access_token=ab`)).toEqual(expected);
    expect(await search(`${P}/_api/search?access_token=zz`)).toEqual(expected);
    expect(
      await search(`https://wiki.example.com${P}/_api/search?access_token=zz`),
    ).toEqual(expected);
  });
});
