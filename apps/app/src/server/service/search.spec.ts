import type { IUser } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import { SearchDelegatorName } from '~/interfaces/named-query';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager/config-manager';

import type { SearchDelegator } from '../interfaces/search';
import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const {
  mockFindSnapshotUsernamesByUsernameRegex,
  mockFindEndpointsByEndpointRegex,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockFindSnapshotUsernamesByUsernameRegex: vi.fn(),
  mockFindEndpointsByEndpointRegex: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: mockLoggerError,
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
      findSnapshotUsernamesByUsernameRegex:
        mockFindSnapshotUsernamesByUsernameRegex,
      findEndpointsByEndpointRegex: mockFindEndpointsByEndpointRegex,
    },
  },
}));

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

class TestSearchService extends SearchService {
  // isConfigured is normally derived from fullTextSearchDelegator; tests flip this
  // directly to exercise both the ES path and the MongoDB fallback path.
  // Two distinct knobs model two distinct failure modes: this one is "ES was
  // never configured for this instance" (isReachable short-circuits before any
  // ES call is attempted), whereas isErrorOccuredOnHealthcheck below models
  // "ES is configured but the periodic healthcheck has marked it unreachable."
  isConfiguredOverride = true;

  // biome-ignore lint/complexity/noUselessConstructor: widens the protected base ctor (factory pattern) to public so the test can instantiate and wire mocks
  public constructor() {
    super();
  }

  override generateFullTextSearchDelegator(): ElasticsearchDelegator {
    return mock<ElasticsearchDelegator>();
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

  override get isConfigured(): boolean {
    return this.isConfiguredOverride;
  }
}

type UserRecord = { username: string; status: number };

// Asymmetric matcher: set-equality for string[] (order/duplication-insensitive),
// which matches $in semantics. Lets us stay inside toHaveBeenCalledWith with no cast.
const sameStringSet = (expected: string[]) => ({
  asymmetricMatch: (actual: unknown): boolean =>
    Array.isArray(actual) &&
    new Set(actual).size === new Set(expected).size &&
    expected.every((e) => actual.includes(e)),
  toString: () => `sameStringSet([${expected.join(', ')}])`,
});

const setupUserModelMock = (
  userModel: MockProxy<Model<IUser>>,
  users: UserRecord[],
) => {
  const query = mockDeep<ReturnType<Model<IUser>['find']>>();
  query.select.mockReturnValue(query);
  query.lean.mockResolvedValue(users);
  userModel.find.mockReturnValue(query);
  vi.spyOn(mongoose, 'model').mockReturnValue(userModel);
};

describe('SearchService.searchAuditlogSuggestions()', () => {
  let searchService: TestSearchService;
  let mockCrowi: MockProxy<Crowi>;
  let mockUserModel: MockProxy<Model<IUser>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCrowi = mock<Crowi>();
    mockCrowi.configManager = configManager;
    // SearchService now uses a protected ctor + async create() factory (dev/8.0.x).
    // create() hardcodes `new SearchService()`, ignoring our subclass override, so wire
    // the mocked delegator manually here instead of calling create().
    searchService = new TestSearchService();
    searchService.crowi = mockCrowi;
    searchService.fullTextSearchDelegator =
      searchService.generateFullTextSearchDelegator();
    mockUserModel = mock<Model<IUser>>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return {} without calling ES when q is empty string', async () => {
    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      '',
      10,
    );

    expect(result).toEqual({});
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should return {} without calling ES when fields does not include username', async () => {
    const result = await searchService.searchAuditlogSuggestions(
      [],
      'alice',
      10,
    );

    expect(result).toEqual({});
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should classify active and inactive usernames from ES results', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['alice', 'bob']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
      { username: 'bob', status: UserStatus.STATUS_SUSPENDED },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: {
        activeUsernames: ['alice'],
        inactiveUsernames: ['bob'],
      },
    });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('username', 'ali', 10);
  });

  it('should classify a username with no matching User doc as inactive, not drop it', async () => {
    // statusDelete() renames the User doc's username to `deleted_at_*`, so a
    // deleted user's original username (still recorded in past activity) has
    // no live User match at all -- it must stay searchable as inactive.
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['alice', 'ghost']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    expect(result.username?.activeUsernames).toEqual(['alice']);
    expect(result.username?.inactiveUsernames).toEqual(['ghost']);
    // Guard the $in narrowing: Mongo queried only for ES-returned names, else leaks others.
    expect(mockUserModel.find).toHaveBeenCalledWith({
      username: { $in: sameStringSet(['alice', 'ghost']) },
    });
  });

  it('should return empty arrays without querying MongoDB when ES returns []', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue([]);
    setupUserModelMock(mockUserModel, []);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'nobody',
      10,
    );

    expect(result).toEqual({
      username: {
        activeUsernames: [],
        inactiveUsernames: [],
      },
    });
    expect(mockUserModel.find).not.toHaveBeenCalled();
    expect(mockFindSnapshotUsernamesByUsernameRegex).not.toHaveBeenCalled();
  });

  it('should classify active and inactive usernames from the MongoDB fallback when ES is not configured', async () => {
    searchService.isConfiguredOverride = false;
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce([
      'alice',
      'bob',
    ]);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
      { username: 'bob', status: UserStatus.STATUS_SUSPENDED },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: {
        activeUsernames: ['alice'],
        inactiveUsernames: ['bob'],
      },
    });
    expect(mockFindSnapshotUsernamesByUsernameRegex).toHaveBeenCalledWith(
      'ali',
      { offset: 0, limit: 10 },
    );
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should fall back to MongoDB when the ES search fails', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockRejectedValue(new Error('ES is down'));
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce(['alice']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: { activeUsernames: ['alice'], inactiveUsernames: [] },
    });
    expect(mockFindSnapshotUsernamesByUsernameRegex).toHaveBeenCalledWith(
      'ali',
      { offset: 0, limit: 10 },
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'ES is down' }) },
      expect.stringContaining('Falling back to MongoDB'),
    );
  });

  it('should use the MongoDB fallback when ES is configured but unreachable', async () => {
    searchService.isErrorOccuredOnHealthcheck = true;
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce(['alice']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: { activeUsernames: ['alice'], inactiveUsernames: [] },
    });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should return endpoints from ES results without any User classification', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/api/v3/pages', '/api/v3/pages/revert']);

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/api',
      10,
    );

    expect(result).toEqual({
      endpoint: { endpoints: ['/api/v3/pages', '/api/v3/pages/revert'] },
    });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/api', 10);
    expect(mockUserModel.find).not.toHaveBeenCalled();
  });

  it('should pass a trimmed q to ES so padded input still matches', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/api/v3/pages']);

    await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '  /api/v3/pages ',
      10,
    );

    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/api/v3/pages', 10);
  });

  it('should search ES by the path when q carries a query string', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/_api/search']);

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/_api/search?q=foo',
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/search'] } });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/_api/search', 10);
  });

  it('should search the MongoDB fallback by the path when q carries a query string', async () => {
    searchService.isConfiguredOverride = false;
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/_api/search']);

    await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/_api/search?q=foo',
      10,
    );

    expect(mockFindEndpointsByEndpointRegex).toHaveBeenCalledWith(
      '/_api/search',
      { offset: 0, limit: 10 },
    );
  });

  it.each([
    '?q=foo',
    '?',
  ])('should return no endpoints without querying either backend when q=%j has no path', async (q) => {
    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      q,
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: [] } });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
    expect(mockFindEndpointsByEndpointRegex).not.toHaveBeenCalled();
  });

  describe.each([
    { backend: 'Elasticsearch', isConfigured: true },
    { backend: 'the MongoDB fallback', isConfigured: false },
  ])('below the minimum query length, on $backend', ({ isConfigured }) => {
    beforeEach(() => {
      searchService.isConfiguredOverride = isConfigured;
      setupUserModelMock(mockUserModel, []);
    });

    it.each([
      {
        field: 'username',
        q: 'a',
        expected: { username: { activeUsernames: [], inactiveUsernames: [] } },
      },
      { field: 'endpoint', q: '/a', expected: { endpoint: { endpoints: [] } } },
      {
        field: 'endpoint',
        q: '/a?q=foo',
        expected: { endpoint: { endpoints: [] } },
      },
    ] as const)('should return no $field suggestions for q=$q without querying either backend', async ({
      field,
      q,
      expected,
    }) => {
      const result = await searchService.searchAuditlogSuggestions(
        [field],
        q,
        10,
      );

      expect(result).toEqual(expected);
      expect(
        searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
      ).not.toHaveBeenCalled();
      expect(mockFindSnapshotUsernamesByUsernameRegex).not.toHaveBeenCalled();
      expect(mockFindEndpointsByEndpointRegex).not.toHaveBeenCalled();
    });
  });

  it.each([
    { field: 'username', q: 'al' },
    { field: 'endpoint', q: '/ap' },
  ] as const)('should query Elasticsearch once q reaches the $field minimum length', async ({
    field,
    q,
  }) => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue([]);
    setupUserModelMock(mockUserModel, []);

    await searchService.searchAuditlogSuggestions([field], q, 10);

    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith(field, q, 10);
  });

  it('should return {} without calling ES when q is whitespace only', async () => {
    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '   ',
      10,
    );

    expect(result).toEqual({});
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should resolve both username and endpoint independently when both fields are requested', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockImplementation(async (field) =>
      field === 'username' ? ['alice'] : ['/api/v3/pages'],
    );
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username', 'endpoint'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: { activeUsernames: ['alice'], inactiveUsernames: [] },
      endpoint: { endpoints: ['/api/v3/pages'] },
    });
  });

  it('should still return the other fields when one field fails', async () => {
    searchService.isConfiguredOverride = false;
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce(['alice']);
    mockFindEndpointsByEndpointRegex.mockRejectedValueOnce(
      new Error('operation exceeded time limit'),
    );
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchService.searchAuditlogSuggestions(
      ['username', 'endpoint'],
      'ali',
      10,
    );

    expect(result).toEqual({
      username: { activeUsernames: ['alice'], inactiveUsernames: [] },
    });
    expect(mockLoggerError).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: 'operation exceeded time limit',
        }),
      },
      expect.stringContaining('(endpoint)'),
    );
  });

  it('should reject when every requested field fails', async () => {
    searchService.isConfiguredOverride = false;
    mockFindSnapshotUsernamesByUsernameRegex.mockRejectedValueOnce(
      new Error('operation exceeded time limit'),
    );
    mockFindEndpointsByEndpointRegex.mockRejectedValueOnce(
      new Error('endpoint scan failed'),
    );

    await expect(
      searchService.searchAuditlogSuggestions(
        ['username', 'endpoint'],
        'ali',
        10,
      ),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'operation exceeded time limit' }),
        expect.objectContaining({ message: 'endpoint scan failed' }),
      ],
    });
    // The caller logs the AggregateError once; per-field logs would duplicate it.
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('should use the MongoDB fallback for endpoint when ES is not configured', async () => {
    searchService.isConfiguredOverride = false;
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/api/v3/pages']);

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/api',
      10,
    );

    expect(result).toEqual({
      endpoint: { endpoints: ['/api/v3/pages'] },
    });
    expect(mockFindEndpointsByEndpointRegex).toHaveBeenCalledWith('/api', {
      offset: 0,
      limit: 10,
    });
    expect(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should fall back to MongoDB for endpoint when the ES search fails', async () => {
    vi.mocked(
      searchService.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockRejectedValue(new Error('ES is down'));
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/api/v3/pages']);

    const result = await searchService.searchAuditlogSuggestions(
      ['endpoint'],
      '/api',
      10,
    );

    expect(result).toEqual({
      endpoint: { endpoints: ['/api/v3/pages'] },
    });
    expect(mockFindEndpointsByEndpointRegex).toHaveBeenCalledWith('/api', {
      offset: 0,
      limit: 10,
    });
  });
});
