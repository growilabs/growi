import type { IUser } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type { IAttachmentHit } from '~/features/search-attachments/interfaces/attachment-search';
import type {
  AttachmentSearchInput,
  AttachmentSearchResultAggregator,
} from '~/features/search-attachments/server/services/attachment-search-result-aggregator';
import { SearchDelegatorName } from '~/interfaces/named-query';
import type { IPageWithSearchMeta } from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager/config-manager';

import type { QueryTerms, SearchDelegator } from '../interfaces/search';
import SearchService from './search';
import type ElasticsearchDelegator from './search-delegator/elasticsearch';

const { mockFindSnapshotUsernamesByUsernameRegex } = vi.hoisted(() => ({
  mockFindSnapshotUsernamesByUsernameRegex: vi.fn(),
}));

vi.mock('~/server/models/named-query', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      findSnapshotUsernamesByUsernameRegex:
        mockFindSnapshotUsernamesByUsernameRegex,
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
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValue([
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
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValue(['alice']);
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
  });

  it('should use the MongoDB fallback when ES is configured but unreachable', async () => {
    searchService.isErrorOccuredOnHealthcheck = true;
    mockFindSnapshotUsernamesByUsernameRegex.mockResolvedValue(['alice']);
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

describe('SearchService.canShowSnippet()', () => {
  const groupId = new mongoose.Types.ObjectId();
  const groupPage = {
    grant: 5,
    grantedUsers: [],
    // the Mongo shape: one { item, type } entry per granted group
    grantedGroups: [{ item: groupId, type: 'UserGroup' }],
  };

  it('shows the snippet of a group page to a member of the group', () => {
    const service = new TestSearchService();

    expect(
      service.canShowSnippet(groupPage, mock<IUser>(), [
        new mongoose.Types.ObjectId(groupId.toString()),
      ]),
    ).toBe(true);
  });

  it('hides the snippet of a group page from a user outside the group', () => {
    const service = new TestSearchService();

    expect(
      service.canShowSnippet(groupPage, mock<IUser>(), [
        new mongoose.Types.ObjectId(),
      ]),
    ).toBe(false);
  });
});

describe('SearchService.searchByFacet() with resolve=full', () => {
  const viewer = { user: null, userGroups: null };
  const input: AttachmentSearchInput = {
    queryString: 'word',
    terms: mock<QueryTerms>(),
    resolvedFilterData: { groupIds: [], notGroupIds: [] },
    viewer,
  };
  const hit = (pageId: string): IAttachmentHit => ({
    attachmentId: `att-${pageId}`,
    pageId,
    fileName: 'a.pdf',
    originalName: 'a.pdf',
    fileFormat: 'pdf',
    fileSize: 1,
    snippets: [],
    pageNumber: 1,
    label: null,
  });
  const pageItem = (
    id: string,
    attachmentHits?: IAttachmentHit[],
  ): IPageWithSearchMeta => ({
    data: mock<IPageWithSearchMeta['data']>({ _id: id }),
    meta: attachmentHits == null ? {} : { attachmentHits },
  });

  let service: TestSearchService;
  let aggregator: MockProxy<AttachmentSearchResultAggregator>;

  beforeEach(() => {
    service = new TestSearchService();
    vi.spyOn(service, 'createAttachmentSearchInput').mockResolvedValue(input);
    aggregator = mock<AttachmentSearchResultAggregator>();
    // the real aggregator rejects more than 20 ids per call
    aggregator.resolveSecondary.mockImplementation(async (_in, opts) => {
      if (opts.primaryIds.length > 20) throw new RangeError('too many ids');
      return {
        facet: 'all',
        enrichments: Object.fromEntries(
          opts.primaryIds
            .filter((id) => id !== 'no-hit')
            .map((id) => [id, { attachmentHits: [hit(id)] }]),
        ),
      };
    });
    service.setAttachmentSearchResultAggregator(aggregator);
  });

  it('attaches hits to the pages that came back without any, keeping the others as they are', async () => {
    const kept = [hit('first')];
    aggregator.searchPrimary.mockResolvedValue({
      facet: 'pages',
      primarySlot: 'pages',
      items: [pageItem('first', kept), pageItem('second'), pageItem('no-hit')],
      meta: { total: 3 },
    });

    const result = await service.searchByFacet('word', viewer, {
      facet: 'all',
      from: 20,
      size: 20,
      resolve: 'full',
    });

    expect(result.items.map((i) => i.meta?.attachmentHits)).toEqual([
      kept,
      [hit('second')],
      undefined,
    ]);
    expect(result.meta).toEqual({ total: 3 });
  });

  it('enriches a page size above the secondary limit in full', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `p${i}`);
    aggregator.searchPrimary.mockResolvedValue({
      facet: 'pages',
      primarySlot: 'pages',
      items: ids.map((id) => pageItem(id)),
      meta: { total: 45 },
    });

    const result = await service.searchByFacet('word', viewer, {
      facet: 'all',
      from: 0,
      size: 45,
      resolve: 'full',
    });

    expect(
      result.items.map((i) => i.meta?.attachmentHits?.[0]?.pageId),
    ).toEqual(ids);
  });

  it.each([
    { facet: 'all' as const, resolve: 'primary' as const },
    { facet: 'attachments' as const, resolve: 'full' as const },
  ])('returns the primary result untouched for facet=$facet resolve=$resolve', async ({
    facet,
    resolve,
  }) => {
    const primary = {
      facet,
      primarySlot: 'pages' as const,
      items: [pageItem('second')],
      meta: { total: 1 },
    };
    aggregator.searchPrimary.mockResolvedValue(primary);

    const result = await service.searchByFacet('word', viewer, {
      facet,
      resolve,
    });

    expect(result).toBe(primary);
  });
});
