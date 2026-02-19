import type { IPage, IUser } from '@growi/core';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { QueryTerms, SearchDelegator } from '~/server/interfaces/search';
import NamedQuery from '~/server/models/named-query';
import type { PageDocument, PageModel } from '~/server/models/page';
import SearchService from '~/server/service/search';

describe('SearchService test', () => {
  let crowi: Crowi;
  let searchService: SearchService;

  const DEFAULT = 'FullTextSearch';
  const PRIVATE_LEGACY_PAGES = 'PrivateLegacyPages';

  let dummyAliasOf: string;

  const dummyFullTextSearchDelegator: SearchDelegator = {
    search() {
      return Promise.resolve({ data: [], meta: { total: 0, hitsCount: 0 } });
    },
    isTermsNormalized(
      terms: Partial<QueryTerms>,
    ): terms is Partial<QueryTerms> {
      return true;
    },
    validateTerms() {
      return [];
    },
  };

  beforeAll(async () => {
    crowi = await getInstance();
    searchService = new SearchService(crowi);
    searchService.nqDelegators = {
      ...searchService.nqDelegators,
      [DEFAULT]: dummyFullTextSearchDelegator, // override with dummy full-text search delegator
    };

    dummyAliasOf =
      'match -notmatch "phrase" -"notphrase" prefix:/pre1 -prefix:/pre2 tag:Tag1 -tag:Tag2';

    // Check if named queries already exist
    const existingNQ1 = await NamedQuery.findOne({
      name: 'search_svc_named_query1',
    });
    if (existingNQ1 == null) {
      await NamedQuery.insertMany([
        {
          name: 'search_svc_named_query1',
          delegatorName: PRIVATE_LEGACY_PAGES,
        },
        { name: 'search_svc_named_query2', aliasOf: dummyAliasOf },
      ]);
    }
  });

  describe('parseQueryString()', () => {
    it('should parse queryString', async () => {
      const queryString =
        'match -notmatch "phrase" -"notphrase" prefix:/pre1 -prefix:/pre2 tag:Tag1 -tag:Tag2';
      const terms = await searchService.parseQueryString(queryString);

      const expected = {
        // QueryTerms
        match: ['match'],
        not_match: ['notmatch'],
        phrase: ['"phrase"'],
        not_phrase: ['"notphrase"'],
        prefix: ['/pre1'],
        not_prefix: ['/pre2'],
        tag: ['Tag1'],
        not_tag: ['Tag2'],
      };

      expect(terms).toStrictEqual(expected);
    });
  });

  describe('parseSearchQuery()', () => {
    it('should return result with delegatorName', async () => {
      const queryString = '/';
      const nqName = 'search_svc_named_query1';
      const parsedQuery = await searchService.parseSearchQuery(
        queryString,
        nqName,
      );

      const expected = {
        queryString,
        delegatorName: PRIVATE_LEGACY_PAGES,
        terms: {
          match: ['/'],
          not_match: [],
          phrase: [],
          not_phrase: [],
          prefix: [],
          not_prefix: [],
          tag: [],
          not_tag: [],
        },
      };

      expect(parsedQuery).toStrictEqual(expected);
    });

    it('should return result with expanded aliasOf value', async () => {
      const queryString = '/';
      const nqName = 'search_svc_named_query2';
      const parsedQuery = await searchService.parseSearchQuery(
        queryString,
        nqName,
      );
      const expected = {
        queryString: dummyAliasOf,
        terms: {
          match: ['match'],
          not_match: ['notmatch'],
          phrase: ['"phrase"'],
          not_phrase: ['"notphrase"'],
          prefix: ['/pre1'],
          not_prefix: ['/pre2'],
          tag: ['Tag1'],
          not_tag: ['Tag2'],
        },
      };

      expect(parsedQuery).toStrictEqual(expected);
    });
  });

  describe('resolve()', () => {
    it('should resolve as full-text search delegator', async () => {
      const parsedQuery = {
        queryString: dummyAliasOf,
        terms: {
          match: ['match'],
          not_match: ['notmatch'],
          phrase: ['"phrase"'],
          not_phrase: ['"notphrase"'],
          prefix: ['/pre1'],
          not_prefix: ['/pre2'],
          tag: ['Tag1'],
          not_tag: ['Tag2'],
        },
      };

      const [delegator, data] = await searchService.resolve(parsedQuery);

      const expectedData = parsedQuery;

      expect(data).toStrictEqual(expectedData);
      expect(typeof delegator.search).toBe('function');
    });

    it('should resolve as custom search delegator', async () => {
      const queryString = '/';
      const parsedQuery = {
        queryString,
        delegatorName: PRIVATE_LEGACY_PAGES,
        terms: {
          match: ['/'],
          not_match: [],
          phrase: [],
          not_phrase: [],
          prefix: [],
          not_prefix: [],
          tag: [],
          not_tag: [],
        },
      };

      const [delegator, data] = await searchService.resolve(parsedQuery);

      const expectedData = {
        queryString: '/',
        terms: parsedQuery.terms,
      };

      expect(data).toStrictEqual(expectedData);
      expect(typeof delegator.search).toBe('function');
    });
  });

  describe('searchKeyword()', () => {
    it('should search with custom search delegator', async () => {
      const Page = mongoose.model<PageDocument, PageModel>('Page');
      const User: Model<IUser> = mongoose.model('User');

      // Create users if they don't exist
      const existingUser1 = await User.findOne({
        username: 'searchSvcDummyUser1',
      });
      if (existingUser1 == null) {
        await User.insertMany([
          {
            name: 'searchSvcDummyUser1',
            username: 'searchSvcDummyUser1',
            email: 'searchSvcDummyUser1@example.com',
          },
          {
            name: 'searchSvcDummyUser2',
            username: 'searchSvcDummyUser2',
            email: 'searchSvcDummyUser2@example.com',
          },
        ]);
      }

      const testUser1 = await User.findOne({ username: 'searchSvcDummyUser1' });
      const testUser2 = await User.findOne({ username: 'searchSvcDummyUser2' });

      if (testUser1 == null || testUser2 == null) {
        throw new Error('Test users not found');
      }

      // Create pages if they don't exist
      const existingPage = await Page.findOne({ path: '/searchSvc_user1' });
      if (existingPage == null) {
        await Page.insertMany([
          {
            path: '/searchSvc_user1',
            grant: Page.GRANT_PUBLIC,
            creator: testUser1,
            lastUpdateUser: testUser1,
          },
          {
            path: '/searchSvc_user1_owner',
            grant: Page.GRANT_OWNER,
            creator: testUser1,
            lastUpdateUser: testUser1,
            grantedUsers: [testUser1._id],
          },
          {
            path: '/searchSvc_user2_public',
            grant: Page.GRANT_PUBLIC,
            creator: testUser2,
            lastUpdateUser: testUser2,
          },
        ]);

        const page1 = await Page.findOne({ path: '/searchSvc_user1' });

        await Page.insertMany([
          {
            path: '/searchSvc_user1/hasParent',
            grant: Page.GRANT_PUBLIC,
            creator: testUser1,
            lastUpdateUser: testUser1,
            parent: page1,
          },
        ]);
      }

      const queryString = '/';
      const nqName = 'search_svc_named_query1';

      const [result, delegatorName] = await searchService.searchKeyword(
        queryString,
        nqName,
        testUser1,
        null,
        { offset: 0, limit: 100 },
      );

      const resultPaths = result.data.map((page: IPage) => page.path);
      const flag =
        resultPaths.includes('/searchSvc_user1') &&
        resultPaths.includes('/searchSvc_user1_owner') &&
        resultPaths.includes('/searchSvc_user2_public');

      expect(flag).toBe(true);
      expect(delegatorName).toBe(PRIVATE_LEGACY_PAGES);
    });
  });
});
