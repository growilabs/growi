import type { IUser } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import { UserStatus } from '~/server/models/user/conts';

import {
  type AuditlogSuggestionBackend,
  searchAuditlogSuggestions,
} from './search-auditlog-suggestions';
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

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      findSnapshotUsernamesByUsernameRegex:
        mockFindSnapshotUsernamesByUsernameRegex,
      findEndpointsByEndpointRegex: mockFindEndpointsByEndpointRegex,
    },
  },
}));

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

const createBackend = (isReachable: boolean): AuditlogSuggestionBackend =>
  mock<AuditlogSuggestionBackend>({
    isReachable,
    fullTextSearchDelegator: mock<ElasticsearchDelegator>(),
  });

describe('searchAuditlogSuggestions()', () => {
  let backend: AuditlogSuggestionBackend;
  let mockUserModel: MockProxy<Model<IUser>>;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = createBackend(true);
    mockUserModel = mock<Model<IUser>>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return {} without calling ES when q is empty string', async () => {
    const result = await searchAuditlogSuggestions(
      backend,
      ['username'],
      '',
      10,
    );

    expect(result).toEqual({});
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should return {} without calling ES when fields does not include username', async () => {
    const result = await searchAuditlogSuggestions(backend, [], 'alice', 10);

    expect(result).toEqual({});
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should classify active and inactive usernames from ES results', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['alice', 'bob']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
      { username: 'bob', status: UserStatus.STATUS_SUSPENDED },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('username', 'ali', 10);
  });

  it('should classify a username with no matching User doc as inactive, not drop it', async () => {
    // statusDelete() renames the User doc's username to `deleted_at_*`, so a
    // deleted user's original username (still recorded in past activity) has
    // no live User match at all -- it must stay searchable as inactive.
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['alice', 'ghost']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue([]);
    setupUserModelMock(mockUserModel, []);

    const result = await searchAuditlogSuggestions(
      backend,
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

  it('should classify active and inactive usernames from the MongoDB fallback when ES is unreachable', async () => {
    backend = createBackend(false);
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce([
      'alice',
      'bob',
    ]);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
      { username: 'bob', status: UserStatus.STATUS_SUSPENDED },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should fall back to MongoDB when the ES search fails', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockRejectedValue(new Error('ES is down'));
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce(['alice']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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

  it('should return endpoints from ES results without any User classification', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/api/v3/pages', '/api/v3/pages/revert']);

    const result = await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      '/api',
      10,
    );

    expect(result).toEqual({
      endpoint: { endpoints: ['/api/v3/pages', '/api/v3/pages/revert'] },
    });
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/api', 10);
    expect(mockUserModel.find).not.toHaveBeenCalled();
  });

  it('should pass a trimmed q to ES so padded input still matches', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/api/v3/pages']);

    await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      '  /api/v3/pages ',
      10,
    );

    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/api/v3/pages', 10);
  });

  const PATH_ONLY_ENDPOINT_QUERIES = [
    '/_api/search?q=foo',
    'https://wiki.example.com/_api/search?q=foo',
    'http://localhost:3000/_api/search',
    '_api/search?q=foo',
    'https://wiki.example.com/_api/search#foo',
    '/_api/search?q=foo#bar',
  ];

  it.each(
    PATH_ONLY_ENDPOINT_QUERIES,
  )('should search ES by the path when q=%j', async (q) => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValue(['/_api/search']);

    const result = await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      q,
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/search'] } });
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('endpoint', '/_api/search', 10);
  });

  it.each(
    PATH_ONLY_ENDPOINT_QUERIES,
  )('should search the MongoDB fallback by the path when q=%j', async (q) => {
    backend = createBackend(false);
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/_api/search']);

    await searchAuditlogSuggestions(backend, ['endpoint'], q, 10);

    expect(mockFindEndpointsByEndpointRegex).toHaveBeenCalledWith(
      '/_api/search',
      { offset: 0, limit: 10 },
    );
  });

  it.each([
    '?q=foo',
    '?',
    'https://wiki.example.com',
    'https://wiki.example.com?q=foo',
    '#foo',
  ])('should return no endpoints without querying either backend when q=%j has no path', async (q) => {
    const result = await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      q,
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: [] } });
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
    expect(mockFindEndpointsByEndpointRegex).not.toHaveBeenCalled();
  });

  describe('below the MongoDB fallback minimum query length', () => {
    beforeEach(() => {
      backend = createBackend(false);
      setupUserModelMock(mockUserModel, []);
    });

    it('should return no username suggestions for q=a without querying MongoDB', async () => {
      const result = await searchAuditlogSuggestions(
        backend,
        ['username'],
        'a',
        10,
      );

      expect(result).toEqual({
        username: { activeUsernames: [], inactiveUsernames: [] },
      });
      expect(mockFindSnapshotUsernamesByUsernameRegex).not.toHaveBeenCalled();
    });

    it('should not fall back to MongoDB for a short q when Elasticsearch fails', async () => {
      backend = createBackend(true);
      vi.mocked(
        backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
      ).mockRejectedValueOnce(new Error('ES is down'));

      const result = await searchAuditlogSuggestions(
        backend,
        ['username'],
        'a',
        10,
      );

      expect(result).toEqual({
        username: { activeUsernames: [], inactiveUsernames: [] },
      });
      expect(mockFindSnapshotUsernamesByUsernameRegex).not.toHaveBeenCalled();
    });
  });

  it('should answer a username q shorter than the fallback minimum from Elasticsearch', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockResolvedValueOnce(['alice']);
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
      ['username'],
      'a',
      10,
    );

    expect(result.username?.activeUsernames).toEqual(['alice']);
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).toHaveBeenCalledWith('username', 'a', 10);
  });

  it.each([
    { q: '/', pathQ: '/' },
    { q: '/a', pathQ: '/a' },
    { q: '/a?q=foo', pathQ: '/a' },
  ])('should answer a short endpoint q=$q from the MongoDB fallback', async ({
    q,
    pathQ,
  }) => {
    backend = createBackend(false);
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/_api/v3/pages']);

    const result = await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      q,
      10,
    );

    expect(result).toEqual({ endpoint: { endpoints: ['/_api/v3/pages'] } });
    expect(mockFindEndpointsByEndpointRegex).toHaveBeenCalledWith(pathQ, {
      offset: 0,
      limit: 10,
    });
  });

  it('should return {} without calling ES when q is whitespace only', async () => {
    const result = await searchAuditlogSuggestions(
      backend,
      ['endpoint'],
      '   ',
      10,
    );

    expect(result).toEqual({});
    expect(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should resolve both username and endpoint independently when both fields are requested', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockImplementation(async (field) =>
      field === 'username' ? ['alice'] : ['/api/v3/pages'],
    );
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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
    backend = createBackend(false);
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValueOnce(['alice']);
    mockFindEndpointsByEndpointRegex.mockRejectedValueOnce(
      new Error('operation exceeded time limit'),
    );
    setupUserModelMock(mockUserModel, [
      { username: 'alice', status: UserStatus.STATUS_ACTIVE },
    ]);

    const result = await searchAuditlogSuggestions(
      backend,
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
    backend = createBackend(false);
    mockFindSnapshotUsernamesByUsernameRegex.mockRejectedValueOnce(
      new Error('operation exceeded time limit'),
    );
    mockFindEndpointsByEndpointRegex.mockRejectedValueOnce(
      new Error('endpoint scan failed'),
    );

    await expect(
      searchAuditlogSuggestions(backend, ['username', 'endpoint'], 'ali', 10),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'operation exceeded time limit' }),
        expect.objectContaining({ message: 'endpoint scan failed' }),
      ],
    });
    // The caller logs the AggregateError once; per-field logs would duplicate it.
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('should use the MongoDB fallback for endpoint when ES is unreachable', async () => {
    backend = createBackend(false);
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/api/v3/pages']);

    const result = await searchAuditlogSuggestions(
      backend,
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
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).not.toHaveBeenCalled();
  });

  it('should fall back to MongoDB for endpoint when the ES search fails', async () => {
    vi.mocked(
      backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard,
    ).mockRejectedValue(new Error('ES is down'));
    mockFindEndpointsByEndpointRegex.mockResolvedValueOnce(['/api/v3/pages']);

    const result = await searchAuditlogSuggestions(
      backend,
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
