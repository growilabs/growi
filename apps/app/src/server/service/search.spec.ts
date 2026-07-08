import type { IUser } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import { SearchDelegatorName } from '~/interfaces/named-query';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager/config-manager';

import type { SearchDelegator } from '../interfaces/search';
import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

vi.mock('~/server/models/named-query', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('~/server/models/activity', () => ({
  default: { findSnapshotUsernamesByUsernameRegex: vi.fn() },
}));

vi.mock('~/server/service/config-manager/config-manager', () => ({
  default: { getConfig: vi.fn() },
  configManager: { getConfig: vi.fn() },
}));

class TestSearchService extends SearchService {
  // isConfigured is normally derived from fullTextSearchDelegator; tests flip this
  // directly to exercise both the ES path and the MongoDB fallback path.
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
    expect(
      Activity.findSnapshotUsernamesByUsernameRegex,
    ).not.toHaveBeenCalled();
  });

  it('should classify active and inactive usernames from the MongoDB fallback when ES is not configured', async () => {
    searchService.isConfiguredOverride = false;
    vi.mocked(Activity.findSnapshotUsernamesByUsernameRegex).mockResolvedValue([
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
    expect(Activity.findSnapshotUsernamesByUsernameRegex).toHaveBeenCalledWith(
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
    vi.mocked(Activity.findSnapshotUsernamesByUsernameRegex).mockResolvedValue([
      'alice',
    ]);
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
    expect(Activity.findSnapshotUsernamesByUsernameRegex).toHaveBeenCalledWith(
      'ali',
      { offset: 0, limit: 10 },
    );
  });

  it('should use the MongoDB fallback when ES is configured but unreachable', async () => {
    searchService.isErrorOccuredOnHealthcheck = true;
    vi.mocked(Activity.findSnapshotUsernamesByUsernameRegex).mockResolvedValue([
      'alice',
    ]);
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
});
