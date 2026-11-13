import { mock } from 'vitest-mock-extended';

import { SearchDelegatorName } from '~/interfaces/named-query';

import type { SearchDelegator } from '../interfaces/search';
import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const { mockFindEndpointsByEndpointRegex } = vi.hoisted(() => ({
  mockFindEndpointsByEndpointRegex: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('~/server/models/named-query', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      findEndpointsByEndpointRegex: mockFindEndpointsByEndpointRegex,
    },
  },
}));

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

class TestSearchService extends SearchService {
  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base ctor (factory pattern) to public so the test can instantiate and wire mocks
  public constructor() {
    super();
  }

  override generateNQDelegators(): {
    [key in SearchDelegatorName]: SearchDelegator;
  } {
    return {
      [SearchDelegatorName.DEFAULT]: mock<SearchDelegator>(),
      [SearchDelegatorName.PRIVATE_LEGACY_PAGES]: mock<SearchDelegator>(),
    };
  }

  override registerUpdateEvent(): void {}
}

// The suggestion logic itself is covered by search-auditlog-suggestions.spec.ts;
// this checks only that SearchService feeds it its own reachability.
describe('SearchService.searchAuditlogSuggestions()', () => {
  let searchService: TestSearchService;
  let esDelegator: ElasticsearchDelegator;

  beforeEach(() => {
    vi.clearAllMocks();
    searchService = new TestSearchService();
    esDelegator = mock<ElasticsearchDelegator>();
    mockFindEndpointsByEndpointRegex.mockResolvedValue(['/_api/v3/pages']);
  });

  it('should search Elasticsearch when it is configured and healthy', async () => {
    searchService.fullTextSearchDelegator = esDelegator;
    vi.mocked(esDelegator.searchAuditlogByFuzzyWildcard).mockResolvedValue([
      '/_api/v3/users',
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/_api',
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/v3/users'] } });
    expect(mockFindEndpointsByEndpointRegex).not.toHaveBeenCalled();
  });

  it('should use the MongoDB fallback when Elasticsearch is not configured', async () => {
    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/_api',
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/v3/pages'] } });
  });

  it('should use the MongoDB fallback when Elasticsearch is configured but the healthcheck failed', async () => {
    searchService.fullTextSearchDelegator = esDelegator;
    searchService.isErrorOccuredOnHealthcheck = true;

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/_api',
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/v3/pages'] } });
    expect(esDelegator.searchAuditlogByFuzzyWildcard).not.toHaveBeenCalled();
  });
});
