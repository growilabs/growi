import type { IUserHasId } from '@growi/core';
import express from 'express';
import request from 'supertest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { IPrimarySearchResult } from '~/features/search-attachments/server/services/attachment-search-result-aggregator';
import type { AttachmentSearchViewer } from '~/features/search-attachments/server/services/search-accessible-pages';
import { SearchDelegatorName } from '~/interfaces/named-query';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import type Crowi from '~/server/crowi';
import { SearchError } from '~/server/models/vo/search-error';
import type ActivityService from '~/server/service/activity';
import type SearchService from '~/server/service/search';

import { setup } from './search';

const { featureEnabled, resolveViewer } = vi.hoisted(() => ({
  featureEnabled: { value: true },
  resolveViewer: vi.fn(),
}));

vi.mock(
  '~/features/search-attachments/server/services/is-attachment-full-text-search-enabled',
  () => ({
    isAttachmentFullTextSearchEnabled: (isSearchServiceConfigured: boolean) =>
      isSearchServiceConfigured && featureEnabled.value,
  }),
);
vi.mock(
  '~/features/search-attachments/server/services/resolve-attachment-search-viewer',
  () => ({ resolveAttachmentSearchViewer: resolveViewer }),
);
vi.mock('../models/user-group-relation', () => ({
  default: { findAllUserGroupIdsRelatedToUser: async () => ['group-1'] },
}));
vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: { findAllUserGroupIdsRelatedToUser: async () => [] },
  }),
);

const loggedInUser = {
  _id: 'user-id-1',
  username: 'search-spec-user',
} as unknown as IUserHasId;

const formattedLegacyResult: IFormattedSearchResult = {
  data: [
    {
      data: {
        _id: 'page-1',
        path: '/legacy',
      } as unknown as IFormattedSearchResult['data'][number]['data'],
      meta: { elasticSearchResult: { snippet: 'legacy <em>hit</em>' } },
    },
  ],
  meta: { took: 3, total: 1, hitsCount: 1 },
};

// Plain data, not a mock: the route serializes it into the response.
const facetResult: IPrimarySearchResult = {
  items: [
    {
      data: {
        _id: 'page-2',
      } as unknown as IPrimarySearchResult['items'][number]['data'],
      meta: { attachmentHits: [] },
    },
  ],
  meta: { primaryResultIncomplete: false },
};

// The items as SearchService answers them with their page documents. Plain
// data, not mock<T>(): the route serializes it, and a vitest-mock-extended
// proxy serializes to undefined and cannot be structuredClone-d.
const formattedFacetItems: IPageWithSearchMeta[] = [
  {
    data: {
      _id: 'page-2',
      path: '/attached',
    } as unknown as IPageWithSearchMeta['data'],
    meta: {
      attachmentHits: [],
      elasticSearchResult: {
        snippet: 'page <em>hit</em>',
        highlightedPath: null,
      },
    },
  },
];

describe('GET /_api/search', () => {
  let searchService: MockProxy<SearchService>;
  let activityService: MockProxy<ActivityService>;
  let app: express.Express;
  let currentUser: IUserHasId | undefined;

  beforeEach(() => {
    featureEnabled.value = true;
    currentUser = undefined;
    resolveViewer.mockImplementation(
      async (user): Promise<AttachmentSearchViewer> => ({
        user: user ?? null,
        userGroups: user == null ? null : ['group-1'],
      }),
    );

    searchService = mock<SearchService>({
      isConfigured: true,
      isReachable: true,
    });
    searchService.searchKeyword.mockResolvedValue([
      { data: [], meta: { total: 1, hitsCount: 1 } },
      SearchDelegatorName.DEFAULT,
    ]);
    // a fresh copy per request: ApiResponse.success adds `ok` to the object it gets
    searchService.formatSearchResult.mockImplementation(async () =>
      structuredClone(formattedLegacyResult),
    );
    searchService.searchByFacet.mockResolvedValue({
      primary: facetResult,
      items: structuredClone(formattedFacetItems),
    });
    activityService = mock<ActivityService>();

    const crowi = mock<Crowi>({ searchService, activityService });
    const { api } = setup(crowi, null);

    app = express();
    app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
      req.user = currentUser;
      next();
    });
    app.get('/_api/search', api.search);
  });

  // The exact bytes the route sent before the facet parameter existed.
  const legacyResponseText = JSON.stringify({
    ...structuredClone(formattedLegacyResult),
    ok: true,
  });

  describe('keeps the existing response when the facet search does not apply', () => {
    it.each([
      { name: 'facet is omitted', query: { q: 'word' } },
      { name: 'facet=pages', query: { q: 'word', facet: 'pages' } },
      {
        name: 'facet is omitted, with resolve=full',
        query: { q: 'word', resolve: 'full' },
      },
      {
        name: 'facet=pages, with an unknown resolve mode',
        query: { q: 'word', facet: 'pages', resolve: 'bogus' },
      },
      {
        name: 'facet=attachments with a named query',
        query: { q: 'word', facet: 'attachments', nq: 'my-query' },
      },
    ])('$name', async ({ query }) => {
      const res = await request(app).get('/_api/search').query(query);

      expect(res.status).toBe(200);
      expect(res.text).toBe(legacyResponseText);
      expect(searchService.searchByFacet).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'facet=all', query: { q: 'word', facet: 'all' } },
      {
        name: 'facet=attachments',
        query: { q: 'word', facet: 'attachments' },
      },
      { name: 'an unknown facet', query: { q: 'word', facet: 'bogus' } },
      { name: 'an empty facet', query: { q: 'word', facet: '' } },
      { name: 'a repeated facet', query: 'q=word&facet=all&facet=pages' },
      { name: 'an object-shaped facet', query: 'q=word&facet[$ne]=pages' },
      {
        name: 'facet=attachments with a page size above the facet search limit',
        query: { q: 'word', facet: 'attachments', limit: '201' },
      },
    ])('$name while attachment search is disabled', async ({ query }) => {
      featureEnabled.value = false;

      const res = await request(app).get('/_api/search').query(query);

      expect(res.status).toBe(200);
      expect(res.text).toBe(legacyResponseText);
      expect(searchService.searchByFacet).not.toHaveBeenCalled();
    });

    it('facet=attachments while Elasticsearch is not configured', async () => {
      searchService = mock<SearchService>({
        isConfigured: false,
        isReachable: true,
      });
      searchService.searchKeyword.mockResolvedValue([
        { data: [], meta: { total: 1, hitsCount: 1 } },
        SearchDelegatorName.DEFAULT,
      ]);
      searchService.formatSearchResult.mockImplementation(async () =>
        structuredClone(formattedLegacyResult),
      );
      const crowi = mock<Crowi>({ searchService, activityService });
      const localApp = express();
      localApp.get('/_api/search', setup(crowi, null).api.search);

      const res = await request(localApp)
        .get('/_api/search')
        .query({ q: 'word', facet: 'attachments' });

      expect(res.text).toBe(legacyResponseText);
      expect(searchService.searchByFacet).not.toHaveBeenCalled();
    });
  });

  describe('facet=attachments', () => {
    it('answers the items with their page documents, a null total and primaryResultIncomplete=false', async () => {
      const res = await request(app)
        .get('/_api/search')
        .query({ q: 'word', facet: 'attachments' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        data: JSON.parse(JSON.stringify(formattedFacetItems)),
        meta: {
          facet: 'attachments',
          total: null,
          hitsCount: 1,
          primaryResultIncomplete: false,
        },
      });
    });

    it('keeps hitsCount at the number of items before those whose page is gone were dropped', async () => {
      searchService.searchByFacet.mockResolvedValue({
        primary: {
          items: [
            ...facetResult.items,
            ...facetResult.items,
            ...facetResult.items,
          ],
          meta: { primaryResultIncomplete: false },
        },
        items: structuredClone(formattedFacetItems),
      });

      const res = await request(app)
        .get('/_api/search')
        .query({ q: 'word', facet: 'attachments', limit: '3' });

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.hitsCount).toBe(3);
    });

    it('reports primaryResultIncomplete as given', async () => {
      searchService.searchByFacet.mockResolvedValue({
        primary: { items: [], meta: { primaryResultIncomplete: true } },
        items: [],
      });

      const res = await request(app)
        .get('/_api/search')
        .query({ q: 'word', facet: 'attachments' });

      expect(res.body.meta).toEqual({
        facet: 'attachments',
        total: null,
        hitsCount: 0,
        primaryResultIncomplete: true,
      });
    });

    it('searches as the logged-in user, with the decoded keyword and paging, ignoring resolve', async () => {
      currentUser = loggedInUser;

      await request(app).get('/_api/search').query({
        q: 'caf%C3%A9',
        facet: 'attachments',
        offset: '20',
        limit: '10',
        resolve: 'full',
      });

      expect(searchService.searchByFacet).toHaveBeenCalledWith(
        'café',
        { user: loggedInUser, userGroups: ['group-1'] },
        { from: 20, size: 10 },
      );
    });

    it('searches as a guest when nobody is logged in, whatever the query says', async () => {
      await request(app).get('/_api/search').query({
        q: 'word',
        facet: 'attachments',
        user: 'someone',
        userGroups: 'x',
      });

      expect(searchService.searchByFacet).toHaveBeenCalledWith(
        'word',
        { user: null, userGroups: null },
        { from: 0, size: 50 },
      );
    });

    it('records the search activity as the page search does', async () => {
      currentUser = loggedInUser;

      await request(app)
        .get('/_api/search')
        .query({ q: 'word', facet: 'attachments' });

      expect(activityService.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SEARCH_PAGE',
          user: loggedInUser._id,
        }),
      );
    });

    it('answers a query with unavailable terms the way the page search does', async () => {
      searchService.searchByFacet.mockRejectedValue(
        new SearchError('The query string includes unavailable terms.', [
          'tag',
        ]),
      );

      const res = await request(app)
        .get('/_api/search')
        .query({ q: 'tag:x', facet: 'attachments' });

      expect(res.body).toMatchObject({
        ok: false,
        code: 400,
        data: { unavailableTermsKeys: ['tag'] },
      });
    });
  });

  describe('rejects malformed facet parameters with a fixed message', () => {
    it.each([
      { name: 'facet=all', query: { q: 'word', facet: 'all' } },
      {
        name: 'facet=all with a named query',
        query: { q: 'word', facet: 'all', nq: 'my-query' },
      },
      { name: 'an unknown facet', query: { q: 'word', facet: 'secret<b>' } },
      { name: 'an empty facet', query: { q: 'word', facet: '' } },
      {
        name: 'a repeated facet',
        query: 'q=word&facet=attachments&facet=pages',
      },
      { name: 'an object-shaped facet', query: 'q=word&facet[$ne]=pages' },
      {
        name: 'a page size above the facet search limit',
        query: { q: 'word', facet: 'attachments', limit: '201' },
      },
    ])('$name', async ({ query }) => {
      const res = await request(app).get('/_api/search').query(query);

      expect(res.body).toMatchObject({ ok: false, code: 400 });
      expect(res.text).not.toContain('secret');
      expect(searchService.searchByFacet).not.toHaveBeenCalled();
      expect(searchService.searchKeyword).not.toHaveBeenCalled();
    });
  });
});
