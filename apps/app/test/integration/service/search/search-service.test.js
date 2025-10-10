/*
 * !! TODO: https://redmine.weseek.co.jp/issues/92050 Fix & adjust test !!
 */

import mongoose from 'mongoose';
import NamedQuery from '~/server/models/named-query';
import SearchService from '~/server/service/search';

const { getInstance } = require('../../setup-crowi');

describe('SearchService test', () => {
  let crowi;
  let searchService;

  const DEFAULT = 'FullTextSearch';
  const PRIVATE_LEGACY_PAGES = 'PrivateLegacyPages';

  // let NamedQuery;

  let dummyAliasOf;

  let namedQuery1;
  let namedQuery2;

  const dummyFullTextSearchDelegator = {
    search() {
      return;
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

    await NamedQuery.insertMany([
      { name: 'named_query1', delegatorName: PRIVATE_LEGACY_PAGES },
      { name: 'named_query2', aliasOf: dummyAliasOf },
    ]);

    namedQuery1 = await NamedQuery.findOne({ name: 'named_query1' });
    namedQuery2 = await NamedQuery.findOne({ name: 'named_query2' });
  });

  describe('parseQueryString()', () => {
    test('should parse queryString', async () => {
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
    test('should return result with delegatorName', async () => {
      const queryString = '/';
      const nqName = 'named_query1';
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

    test('should return result with expanded aliasOf value', async () => {
      const queryString = '/';
      const nqName = 'named_query2';
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
    test('should resolve as full-text search delegator', async () => {
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

    test('should resolve as custom search delegator', async () => {
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
    test('should search with custom search delegator', async () => {
      const Page = mongoose.model('Page');
      const User = mongoose.model('User');
      await User.insertMany([
        {
          name: 'dummyuser1',
          username: 'dummyuser1',
          email: 'dummyuser1@example.com',
        },
        {
          name: 'dummyuser2',
          username: 'dummyuser2',
          email: 'dummyuser2@example.com',
        },
      ]);

      const testUser1 = await User.findOne({ username: 'dummyuser1' });
      const testUser2 = await User.findOne({ username: 'dummyuser2' });

      await Page.insertMany([
        {
          path: '/user1',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/user1_owner',
          grant: Page.GRANT_OWNER,
          creator: testUser1,
          lastUpdateUser: testUser1,
          grantedUsers: [testUser1._id],
        },
        {
          path: '/user2_public',
          grant: Page.GRANT_PUBLIC,
          creator: testUser2,
          lastUpdateUser: testUser2,
        },
      ]);

      const page1 = await Page.findOne({ path: '/user1' });

      await Page.insertMany([
        {
          path: '/user1/hasParent',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
          parent: page1,
        },
      ]);

      const queryString = '/';
      const nqName = 'named_query1';

      const [result, delegatorName] = await searchService.searchKeyword(
        queryString,
        nqName,
        testUser1,
        null,
        { offset: 0, limit: 100 },
      );

      const resultPaths = result.data.map((page) => page.path);
      const flag =
        resultPaths.includes('/user1') &&
        resultPaths.includes('/user1_owner') &&
        resultPaths.includes('/user2_public');

      expect(flag).toBe(true);
      expect(delegatorName).toBe(PRIVATE_LEGACY_PAGES);
    });
  });
});
