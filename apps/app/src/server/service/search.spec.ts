import { type IUser, PageGrant } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { type MockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type {
  AttachmentSearchInput,
  AttachmentSearchResultAggregator,
} from '~/features/search-attachments/server/services/attachment-search-result-aggregator';
import { SearchDelegatorName } from '~/interfaces/named-query';
import type { IPageWithSearchMeta } from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager/config-manager';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import type { QueryTerms, SearchDelegator } from '../interfaces/search';
import SearchService from './search';
import ElasticsearchDelegator from './search-delegator/elasticsearch';
import type { SocketIoService } from './socket-io';

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

  it.each([
    ['an entry without item', [{ type: 'UserGroup' }]],
    ['a null entry', [null]],
    ['a bare group id', [groupId]],
  ])('hides the snippet, without throwing, when grantedGroups holds %s', (_label, grantedGroups) => {
    const service = new TestSearchService();
    const legacyPage = { ...groupPage, grantedGroups };

    expect(
      service.canShowSnippet(legacyPage, mock<IUser>(), [
        new mongoose.Types.ObjectId(groupId.toString()),
      ]),
    ).toBe(false);
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

describe('SearchService.searchByFacet()', () => {
  const viewer = { user: null, userGroups: null };

  it('fails when the attachment search is not initialized', async () => {
    await expect(
      new TestSearchService().searchByFacet('word', viewer, {}),
    ).rejects.toThrow('Attachment search is not initialized');
  });
});

describe('SearchService.resolveAttachmentSecondary()', () => {
  const viewer = { user: null, userGroups: null };
  const input: AttachmentSearchInput = {
    queryString: 'word',
    terms: mock<QueryTerms>(),
    resolvedFilterData: { groupIds: [], notGroupIds: [] },
    viewer,
  };

  let service: TestSearchService;

  beforeEach(() => {
    service = new TestSearchService();
    vi.spyOn(service, 'createAttachmentSearchInput').mockResolvedValue(input);
  });

  it('answers the enrichments the aggregator resolves for the client-supplied ids', async () => {
    const aggregator = mock<AttachmentSearchResultAggregator>();
    aggregator.resolveSecondary.mockResolvedValue({ enrichments: {} });
    service.setAttachmentSearchResultAggregator(aggregator);

    const result = await service.resolveAttachmentSecondary('word', viewer, {
      primaryIds: ['p1'],
    });

    expect(result).toEqual({ enrichments: {} });
    expect(aggregator.resolveSecondary).toHaveBeenCalledWith(input, {
      primaryIds: ['p1'],
    });
  });

  it('propagates a failure of the aggregator', async () => {
    const aggregator = mock<AttachmentSearchResultAggregator>();
    aggregator.resolveSecondary.mockRejectedValue(new Error('es down'));
    service.setAttachmentSearchResultAggregator(aggregator);

    await expect(
      service.resolveAttachmentSecondary('word', viewer, {
        primaryIds: ['p1'],
      }),
    ).rejects.toThrow('es down');
  });

  it('fails instead of answering an empty result when the attachment search is not initialized', async () => {
    await expect(
      service.resolveAttachmentSecondary('word', viewer, {
        primaryIds: ['p1'],
      }),
    ).rejects.toThrow('Attachment search is not initialized');
  });
});

describe('page documents and snippets', () => {
  const TestUser =
    mongoose.models.User ??
    mongoose.model(
      'User',
      new mongoose.Schema({
        username: String,
        password: String,
        email: String,
        isEmailPublished: Boolean,
      }),
    );
  const TestPage =
    mongoose.models.SearchSpecPage ??
    mongoose.model(
      'SearchSpecPage',
      new mongoose.Schema({
        path: String,
        revision: String,
        grant: Number,
        seenUsers: [String],
        lastUpdateUser: mongoose.Schema.Types.Mixed,
        creator: mongoose.Schema.Types.Mixed,
      }),
    );

  const createUser = () =>
    new TestUser({
      username: 'editor',
      password: 'secret-hash',
      email: 'editor@example.com',
      isEmailPublished: false,
    });
  const createPage = (path: string, grant: number) =>
    new TestPage({
      path,
      revision: `revision-of-${path}`,
      grant,
      seenUsers: ['u1', 'u2'],
      lastUpdateUser: createUser(),
      creator: createUser(),
    });

  const toJson = (value: unknown) => JSON.parse(JSON.stringify(value));

  class PageReadingSearchService extends TestSearchService {
    pagesInMongo: InstanceType<typeof TestPage>[] = [];

    protected override findPageListByIds(pageIds: ObjectIdLike[]) {
      const ids = pageIds.map(String);
      const pages = this.pagesInMongo.filter((page) =>
        ids.includes(String(page._id)),
      );
      return Promise.resolve({ pages });
    }
  }

  let service: PageReadingSearchService;

  beforeEach(() => {
    vi.mocked(configManager.getConfig).mockImplementation((key) =>
      key === 'app:elasticsearchVersion' ? 8 : undefined,
    );
    service = new PageReadingSearchService();
    service.crowi = mock<Crowi>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('SearchService.formatSearchResult()', () => {
    it('answers the page document with the tags, the bookmark count and the filtered snippet', async () => {
      const page = createPage('/matched', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [page];

      const result = await service.formatSearchResult(
        {
          data: [
            {
              _id: String(page._id),
              _score: 1,
              _source: { tag_names: ['tag-a'], bookmark_count: 3 },
              _highlight: {
                'body.en': [
                  'a <em class="highlighted-keyword">word</em><script>x</script>',
                ],
                'path.en': ['/<em class="highlighted-keyword">matched</em>'],
              },
            },
            {
              _id: new mongoose.Types.ObjectId().toString(),
              _score: 1,
              _source: {},
              _highlight: {},
            },
          ],
          meta: { total: 2, hitsCount: 2, took: 1 },
        },
        SearchDelegatorName.DEFAULT,
        null,
        null,
      );

      const json = toJson(result);
      expect(json.meta).toEqual({ total: 2, hitsCount: 2, took: 1 });
      expect(json.data).toHaveLength(1);
      expect(json.data[0].data).toMatchObject({
        path: '/matched',
        revision: 'revision-of-/matched',
        tags: ['tag-a'],
        seenUserCount: 2,
        lastUpdateUser: { username: 'editor' },
        creator: { username: 'editor' },
      });
      expect(json.data[0].data.lastUpdateUser).not.toHaveProperty('password');
      expect(json.data[0].data.lastUpdateUser).not.toHaveProperty('email');
      expect(json.data[0].meta).toEqual({
        bookmarkCount: 3,
        elasticSearchResult: {
          snippet:
            'a <em class="highlighted-keyword">word</em>&lt;script&gt;x&lt;/script&gt;',
          highlightedPath: '/<em class="highlighted-keyword">matched</em>',
        },
      });
    });
  });

  describe('SearchService.searchByFacet() items', () => {
    const viewer = { user: null, userGroups: null };
    const VIEWER_FILTER = { term: { 'viewer-filter': 'guest' } };

    const itemOf = (page: { _id: unknown }): IPageWithSearchMeta => ({
      data: mock<IPageWithSearchMeta['data']>({ _id: String(page._id) }),
      meta: { attachmentHits: [] },
    });
    const pageHit = (
      page: { _id: unknown },
      highlight: object,
      source: { bookmark_count?: number } = {},
    ) => ({
      _id: String(page._id),
      _score: 1,
      _source: source,
      _highlight: highlight,
    });

    let delegator: ElasticsearchDelegator;

    beforeEach(() => {
      delegator = new ElasticsearchDelegator(mock<SocketIoService>());
      // Stands in for page search's viewer filter, which reads the Page model.
      vi.spyOn(delegator, 'filterPagesByViewer').mockImplementation((query) => {
        const filter = query.body?.query?.bool?.filter;
        if (Array.isArray(filter)) filter.push(VIEWER_FILTER);
      });
      service.fullTextSearchDelegator = delegator;
      service.nqDelegators = {
        [SearchDelegatorName.DEFAULT]: delegator,
        [SearchDelegatorName.PRIVATE_LEGACY_PAGES]: mock<SearchDelegator>(),
      };
      aggregator = mock<AttachmentSearchResultAggregator>();
      service.setAttachmentSearchResultAggregator(aggregator);
    });

    let aggregator: MockProxy<AttachmentSearchResultAggregator>;

    const searchItems = async (
      primaryItems: IPageWithSearchMeta[],
    ): Promise<IPageWithSearchMeta[]> => {
      aggregator.searchPrimary.mockResolvedValue({
        items: primaryItems,
        meta: { primaryResultIncomplete: false },
      });
      return (await service.searchByFacet('word', viewer, {})).items;
    };

    it('answers the attachment search for the parsed query and the requested page', async () => {
      const page = createPage('/page', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [page];
      vi.spyOn(delegator, 'searchKeyword').mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });
      const primary = {
        items: [itemOf(page)],
        meta: { primaryResultIncomplete: true },
      };
      aggregator.searchPrimary.mockResolvedValue(primary);

      const result = await service.searchByFacet('word', viewer, {
        from: 20,
        size: 10,
      });

      expect(result.primary).toBe(primary);
      expect(toJson(result.items).map((item) => item.data.path)).toEqual([
        '/page',
      ]);
      expect(aggregator.searchPrimary).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: 'word',
          terms: expect.objectContaining({ match: ['word'] }),
          viewer,
        }),
        { from: 20, size: 10 },
      );
    });

    it('answers the page documents in the given order and drops the items whose page is gone', async () => {
      const first = createPage('/first', PageGrant.GRANT_PUBLIC);
      const second = createPage('/second', PageGrant.GRANT_PUBLIC);
      const gone = createPage('/gone', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [first, second];
      vi.spyOn(delegator, 'searchKeyword').mockResolvedValue({
        data: [],
        meta: { total: 0, hitsCount: 0 },
      });

      const result = await searchItems([
        itemOf(second),
        itemOf(gone),
        itemOf(first),
      ]);

      const json = toJson(result);
      expect(json.map((item) => item.data.path)).toEqual(['/second', '/first']);
      expect(json[0].data).toMatchObject({
        revision: 'revision-of-/second',
        seenUserCount: 2,
        lastUpdateUser: { username: 'editor' },
      });
      expect(json[0].data.lastUpdateUser).not.toHaveProperty('password');
      expect(json[0].data.lastUpdateUser).not.toHaveProperty('email');
      expect(json[0].data.creator).not.toHaveProperty('password');
      expect(json[0].meta).toEqual({ attachmentHits: [] });
    });

    it('adds the snippet only to the pages that also match the query, from one search restricted to their ids', async () => {
      const matched = createPage('/matched', PageGrant.GRANT_PUBLIC);
      const unmatched = createPage('/unmatched', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [matched, unmatched];
      const searchKeyword = vi
        .spyOn(delegator, 'searchKeyword')
        .mockResolvedValue({
          data: [
            pageHit(
              matched,
              {
                body: [
                  'the <em class="highlighted-keyword">word</em><img src=x onerror=alert(1)>',
                ],
              },
              { bookmark_count: 4 },
            ),
          ],
          meta: { total: 1, hitsCount: 1 },
        });

      const result = await searchItems([itemOf(matched), itemOf(unmatched)]);

      expect(toJson(result).map((item) => item.meta)).toEqual([
        {
          attachmentHits: [],
          bookmarkCount: 4,
          elasticSearchResult: {
            snippet:
              'the <em class="highlighted-keyword">word</em>&lt;img src=x onerror=alert(1)&gt;',
            highlightedPath: null,
          },
        },
        { attachmentHits: [] },
      ]);
      expect(searchKeyword).toHaveBeenCalledTimes(1);
      const query = searchKeyword.mock.calls[0][0];
      expect(query.body?.query?.bool?.filter).toContainEqual({
        ids: {
          values: sameStringSet([String(matched._id), String(unmatched._id)]),
        },
      });
      expect(query.body?.query?.bool?.filter).toContainEqual(VIEWER_FILTER);
      expect(query.body?.highlight).toBeDefined();
    });

    it('withholds the snippet of a page whose content the viewer may not see, as page search does', async () => {
      const ownerOnly = createPage('/owner-only', PageGrant.GRANT_OWNER);
      service.pagesInMongo = [ownerOnly];
      vi.spyOn(delegator, 'searchKeyword').mockResolvedValue({
        data: [
          pageHit(ownerOnly, {
            body: ['<em class="highlighted-keyword">word</em>'],
            'path.en': ['/<em class="highlighted-keyword">owner-only</em>'],
          }),
        ],
        meta: { total: 1, hitsCount: 1 },
      });

      const [item] = await searchItems([itemOf(ownerOnly)]);

      expect(item.meta?.elasticSearchResult).toEqual({
        snippet: null,
        highlightedPath: '/<em class="highlighted-keyword">owner-only</em>',
      });
    });

    it('answers a bookmark count of 0 for a snippet item whose hit carries none, as page search does', async () => {
      const page = createPage('/page', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [page];
      vi.spyOn(delegator, 'searchKeyword').mockResolvedValue({
        data: [
          pageHit(page, {
            body: ['<em class="highlighted-keyword">word</em>'],
          }),
        ],
        meta: { total: 1, hitsCount: 1 },
      });

      const [item] = await searchItems([itemOf(page)]);

      expect(item.meta?.bookmarkCount).toBe(0);
    });

    it('answers the items without snippets when the snippet search fails', async () => {
      const page = createPage('/page', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [page];
      vi.spyOn(delegator, 'searchKeyword').mockRejectedValue(
        new Error('es down'),
      );

      const result = await searchItems([itemOf(page)]);

      expect(toJson(result)).toEqual([
        expect.objectContaining({
          data: expect.objectContaining({ path: '/page' }),
          meta: { attachmentHits: [] },
        }),
      ]);
    });

    it('answers the items without snippets once the snippet search takes 500ms', async () => {
      vi.useFakeTimers();
      const page = createPage('/page', PageGrant.GRANT_PUBLIC);
      service.pagesInMongo = [page];
      vi.spyOn(delegator, 'searchKeyword').mockReturnValue(
        new Promise(() => {}),
      );

      let result: IPageWithSearchMeta[] | undefined;
      searchItems([itemOf(page)]).then((items) => {
        result = items;
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(result).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(toJson(result)).toEqual([
        expect.objectContaining({ meta: { attachmentHits: [] } }),
      ]);
    });

    it('answers no items without searching when there are none', async () => {
      const searchKeyword = vi.spyOn(delegator, 'searchKeyword');

      expect(await searchItems([])).toEqual([]);
      expect(searchKeyword).not.toHaveBeenCalled();
    });
  });
});
