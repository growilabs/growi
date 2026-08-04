/**
 * Regression guard: searchAuditlogSuggestions must reach the real Prisma
 * MongoDB fallback (not a mock) when Elasticsearch is unreachable. A prior
 * version passed the Prisma extension method as a bare function reference
 * through the field-handler registry, detaching it from `this` and throwing
 * `Cannot read properties of undefined (reading 'aggregateRaw')` at runtime
 * — invisible to search.spec.ts because that file mocks `~/utils/prisma`
 * entirely, so the detached call never touched the real extension context.
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

function makeActivityData(overrides: { username?: string; endpoint?: string }) {
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: 'PAGE_CREATE',
    createdAt: new Date(),
    endpoint: overrides.endpoint ?? '/test/suggestions-fallback',
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
      data: [makeActivityData({ endpoint: '/api/v3/pages' })],
    });

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/api',
      10,
    );

    expect(result.endpoint?.endpoints).toContain('/api/v3/pages');
  });
});
