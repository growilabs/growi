import type { IPageHasId } from '@growi/core';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import mongoose from 'mongoose';
import { FilterXSS } from 'xss';

import { CommentEvent, commentEvent } from '~/features/comment/server';
import {
  isIncludeAiMenthion,
  removeAiMenthion,
} from '~/features/search/utils/ai';
import { SearchDelegatorName } from '~/interfaces/named-query';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
  ISearchResult,
} from '~/interfaces/search';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import type {
  ParsedQuery,
  QueryTerms,
  SearchableData,
  SearchDelegator,
  SearchQueryParser,
  SearchResolver,
} from '../interfaces/search';
import NamedQuery from '../models/named-query';
import type { PageModel } from '../models/page';
import { SearchError } from '../models/vo/search-error';
import { hasIntersection } from '../util/compare-objectId';
import { configManager } from './config-manager';
import ElasticsearchDelegator from './search-delegator/elasticsearch';
import PrivateLegacyPagesDelegator from './search-delegator/private-legacy-pages';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:service:search');

const nonNullable = <T>(value: T): value is NonNullable<T> => value != null;

// options for filtering xss
// Do not change the property key name to 'whitelist" because it depends on the 'xss' library
const filterXssOptions = {
  whiteList: {
    em: ['class'],
  },
};

const filterXss = new FilterXSS(filterXssOptions);

const normalizeQueryString = (_queryString: string): string => {
  let queryString = _queryString.trim();
  queryString = removeAiMenthion(queryString).replace(/\s+/g, ' ');

  return queryString;
};

const normalizeNQName = (nqName: string): string => {
  return nqName.trim();
};

const findPageListByIds = async (pageIds: ObjectIdLike[], crowi: any) => {
  const Page = crowi.model('Page') as unknown as PageModel;
  const User = crowi.model('User');

  const builder = new Page.PageQueryBuilder(
    Page.find({ _id: { $in: pageIds } }),
    false,
  );

  builder.addConditionToPagenate(undefined, undefined); // offset and limit are unnesessary

  builder.populateDataToList(User.USER_FIELDS_EXCEPT_CONFIDENTIAL); // populate lastUpdateUser
  builder.query = builder.query.populate({
    path: 'creator',
    select: User.USER_FIELDS_EXCEPT_CONFIDENTIAL,
  });

  const pages = await builder.query.clone().exec('find');
  const totalCount = await builder.query.exec('count');

  return {
    pages,
    totalCount,
  };
};

class SearchService implements SearchQueryParser, SearchResolver {
  crowi: Crowi;

  isErrorOccuredOnHealthcheck: boolean | null;

  isErrorOccuredOnSearching: boolean | null;

  fullTextSearchDelegator: any & ElasticsearchDelegator;

  nqDelegators: { [key in SearchDelegatorName]: SearchDelegator };

  constructor(crowi: Crowi) {
    this.crowi = crowi;

    this.isErrorOccuredOnHealthcheck = null;
    this.isErrorOccuredOnSearching = null;

    try {
      this.fullTextSearchDelegator = this.generateFullTextSearchDelegator();
      this.nqDelegators = this.generateNQDelegators(
        this.fullTextSearchDelegator,
      );
      logger.info('Succeeded to initialize search delegators');
    } catch (err) {
      logger.error(err);
    }

    if (this.isConfigured) {
      this.fullTextSearchDelegator.init();
      this.registerUpdateEvent();
    }
  }

  get isConfigured() {
    return this.fullTextSearchDelegator != null;
  }

  get isReachable() {
    return (
      this.isConfigured &&
      !this.isErrorOccuredOnHealthcheck &&
      !this.isErrorOccuredOnSearching
    );
  }

  get isElasticsearchEnabled() {
    const uri = configManager.getConfig('app:elasticsearchUri');
    return uri != null && uri.length > 0;
  }

  generateFullTextSearchDelegator() {
    logger.info('Initializing search delegator');

    if (this.isElasticsearchEnabled) {
      logger.info('Elasticsearch is enabled');
      return new ElasticsearchDelegator(this.crowi.socketIoService);
    }

    logger.info(
      'No elasticsearch URI is specified so that full text search is disabled.',
    );
  }

  generateNQDelegators(defaultDelegator: ElasticsearchDelegator): {
    [key in SearchDelegatorName]: SearchDelegator;
  } {
    return {
      [SearchDelegatorName.DEFAULT]: defaultDelegator,
      [SearchDelegatorName.PRIVATE_LEGACY_PAGES]:
        new PrivateLegacyPagesDelegator() as unknown as SearchDelegator,
    };
  }

  registerUpdateEvent() {
    const pageEvent = this.crowi.event('page');
    pageEvent.on(
      'create',
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on(
      'update',
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on('delete', (targetPage, deletedPage, user) => {
      this.fullTextSearchDelegator.syncPageDeleted.bind(
        this.fullTextSearchDelegator,
      )(targetPage, user);
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      )(deletedPage, user);
    });
    pageEvent.on('revert', (targetPage, revertedPage, user) => {
      this.fullTextSearchDelegator.syncPageDeleted.bind(
        this.fullTextSearchDelegator,
      )(targetPage, user);
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      )(revertedPage, user);
    });
    pageEvent.on(
      'deleteCompletely',
      this.fullTextSearchDelegator.syncPageDeleted.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on(
      'syncDescendantsDelete',
      this.fullTextSearchDelegator.syncDescendantsPagesDeleted.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on(
      'updateMany',
      this.fullTextSearchDelegator.syncPagesUpdated.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on(
      'syncDescendantsUpdate',
      this.fullTextSearchDelegator.syncDescendantsPagesUpdated.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on(
      'addSeenUsers',
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      ),
    );
    pageEvent.on('rename', () => {
      this.fullTextSearchDelegator.syncPageDeleted.bind(
        this.fullTextSearchDelegator,
      );
      this.fullTextSearchDelegator.syncPageUpdated.bind(
        this.fullTextSearchDelegator,
      );
    });

    const bookmarkEvent = this.crowi.event('bookmark');
    bookmarkEvent.on(
      'create',
      this.fullTextSearchDelegator.syncBookmarkChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );
    bookmarkEvent.on(
      'delete',
      this.fullTextSearchDelegator.syncBookmarkChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );

    const tagEvent = this.crowi.event('tag');
    tagEvent.on(
      'update',
      this.fullTextSearchDelegator.syncTagChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );

    commentEvent.on(
      CommentEvent.CREATE,
      this.fullTextSearchDelegator.syncCommentChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );
    commentEvent.on(
      CommentEvent.UPDATE,
      this.fullTextSearchDelegator.syncCommentChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );
    commentEvent.on(
      CommentEvent.DELETE,
      this.fullTextSearchDelegator.syncCommentChanged.bind(
        this.fullTextSearchDelegator,
      ),
    );
  }

  resetErrorStatus() {
    this.isErrorOccuredOnHealthcheck = false;
    this.isErrorOccuredOnSearching = false;
  }

  async reconnectClient() {
    logger.info('Try to reconnect...');
    this.fullTextSearchDelegator.initClient();

    try {
      await this.getInfoForHealth();

      logger.info('Reconnecting succeeded.');
      this.resetErrorStatus();
    } catch (err) {
      throw err;
    }
  }

  async getInfo() {
    try {
      return await this.fullTextSearchDelegator.getInfo();
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  async getInfoForHealth() {
    try {
      const result = await this.fullTextSearchDelegator.getInfoForHealth();

      this.isErrorOccuredOnHealthcheck = false;
      return result;
    } catch (err) {
      logger.error(err);

      // switch error flag, `isErrorOccuredOnHealthcheck` to be `false`
      this.isErrorOccuredOnHealthcheck = true;
      throw err;
    }
  }

  async getInfoForAdmin() {
    return this.fullTextSearchDelegator.getInfoForAdmin();
  }

  async normalizeIndices() {
    return this.fullTextSearchDelegator.normalizeIndices();
  }

  async rebuildIndex() {
    return this.fullTextSearchDelegator.rebuildIndex();
  }

  async parseSearchQuery(
    queryString: string,
    nqName: string | null,
  ): Promise<ParsedQuery> {
    // eslint-disable-next-line no-param-reassign
    queryString = normalizeQueryString(queryString);

    const terms = this.parseQueryString(queryString);

    if (nqName == null) {
      return { queryString, terms };
    }

    const nq = await NamedQuery.findOne({ name: normalizeNQName(nqName) });

    // will delegate to full-text search
    if (nq == null) {
      logger.debug(
        `Delegated to full-text search since a named query document did not found. (nqName="${nqName}")`,
      );
      return { queryString, terms };
    }

    const { aliasOf, delegatorName } = nq;

    let parsedQuery: ParsedQuery;
    if (aliasOf != null) {
      parsedQuery = {
        queryString: normalizeQueryString(aliasOf),
        terms: this.parseQueryString(aliasOf),
      };
    } else {
      parsedQuery = { queryString, terms, delegatorName };
    }

    return parsedQuery;
  }

  async resolve(
    parsedQuery: ParsedQuery,
  ): Promise<[SearchDelegator, SearchableData]> {
    const {
      queryString,
      terms,
      delegatorName = SearchDelegatorName.DEFAULT,
    } = parsedQuery;
    const nqDeledator = this.nqDelegators[delegatorName];

    const data = {
      queryString,
      terms,
    };
    return [nqDeledator, data];
  }

  /**
   * Throws SearchError if data is corrupted.
   * @param {SearchableData} data
   * @param {SearchDelegator} delegator
   * @throws {SearchError} SearchError
   */
  private validateSearchableData(
    delegator: SearchDelegator,
    data: SearchableData,
  ): void {
    const { terms } = data;

    if (delegator.isTermsNormalized(terms)) {
      return;
    }

    const unavailableTermsKeys = delegator.validateTerms(terms);

    throw new SearchError(
      'The query string includes unavailable terms.',
      unavailableTermsKeys,
    );
  }

  async searchKeyword(
    keyword: string,
    nqName: string | null,
    user,
    userGroups,
    searchOpts,
  ): Promise<[ISearchResult<unknown>, string | null]> {
    let parsedQuery: ParsedQuery;
    // parse
    try {
      parsedQuery = await this.parseSearchQuery(keyword, nqName);
    } catch (err) {
      logger.error('Error occurred while parseSearchQuery', err);
      throw err;
    }

    if (isIncludeAiMenthion(keyword)) {
      searchOpts.vector = true;
    }

    let delegator: SearchDelegator;
    let data: SearchableData;
    // resolve
    try {
      [delegator, data] = await this.resolve(parsedQuery);
    } catch (err) {
      logger.error('Error occurred while resolving search delegator', err);
      throw err;
    }

    // throws
    this.validateSearchableData(delegator, data);

    return [
      await delegator.search(data, user, userGroups, searchOpts),
      delegator.name ?? null,
    ];
  }

  parseQueryString(queryString: string): QueryTerms {
    // terms
    const matchWords: string[] = [];
    const notMatchWords: string[] = [];
    const phraseWords: string[] = [];
    const notPhraseWords: string[] = [];
    const prefixPaths: string[] = [];
    const notPrefixPaths: string[] = [];
    const tags: string[] = [];
    const notTags: string[] = [];

    // First: Parse phrase keywords
    const phraseRegExp = new RegExp(/(-?"[^"]+")/g);
    const phrases = queryString.match(phraseRegExp);

    if (phrases !== null) {
      queryString = queryString.replace(phraseRegExp, ''); // eslint-disable-line no-param-reassign

      phrases.forEach((phrase) => {
        phrase.trim();
        if (phrase.match(/^-/)) {
          notPhraseWords.push(phrase.replace(/^-/, ''));
        } else {
          phraseWords.push(phrase);
        }
      });
    }

    // Second: Parse other keywords (include minus keywords)
    queryString.split(' ').forEach((word) => {
      if (word === '') {
        return;
      }

      // https://regex101.com/r/pN9XfK/1
      const matchNegative = word.match(/^-(prefix:|tag:)?(.+)$/);
      // https://regex101.com/r/3qw9FQ/1
      const matchPositive = word.match(/^(prefix:|tag:)?(.+)$/);

      if (matchNegative != null) {
        if (matchNegative[1] === 'prefix:') {
          notPrefixPaths.push(matchNegative[2]);
        } else if (matchNegative[1] === 'tag:') {
          notTags.push(matchNegative[2]);
        } else {
          notMatchWords.push(matchNegative[2]);
        }
      } else if (matchPositive != null) {
        if (matchPositive[1] === 'prefix:') {
          prefixPaths.push(matchPositive[2]);
        } else if (matchPositive[1] === 'tag:') {
          tags.push(matchPositive[2]);
        } else {
          matchWords.push(matchPositive[2]);
        }
      }
    });

    const terms = {
      match: matchWords,
      not_match: notMatchWords,
      phrase: phraseWords,
      not_phrase: notPhraseWords,
      prefix: prefixPaths,
      not_prefix: notPrefixPaths,
      tag: tags,
      not_tag: notTags,
    };

    return terms;
  }

  // TODO: optimize the way to check isFormattable e.g. check data schema of searchResult
  // So far, it determines by delegatorName passed by searchService.searchKeyword
  checkIsFormattable(
    searchResult,
    delegatorName: SearchDelegatorName,
  ): boolean {
    return delegatorName === SearchDelegatorName.DEFAULT;
  }

  /**
   * formatting result
   */
  async formatSearchResult(
    searchResult: ISearchResult<any>,
    delegatorName: SearchDelegatorName,
    user,
    userGroups,
  ): Promise<IFormattedSearchResult> {
    if (!this.checkIsFormattable(searchResult, delegatorName)) {
      const data: IPageWithSearchMeta[] = searchResult.data.map((page) => {
        return {
          data: page as IPageHasId,
        };
      });

      return {
        data,
        meta: searchResult.meta,
      };
    }

    /*
     * Format ElasticSearch result
     */
    const User = this.crowi.model('User');
    const result = {} as IFormattedSearchResult;

    // get page data
    const pageIds: string[] = searchResult.data.map((page) => {
      return page._id;
    });

    const findPageResult = await findPageListByIds(pageIds, this.crowi);

    // set meta data
    result.meta = searchResult.meta;

    // set search result page data
    const pages: (IPageWithSearchMeta | null)[] = searchResult.data.map(
      (data) => {
        const pageData = findPageResult.pages.find((pageData) => {
          return pageData.id === data._id;
        });

        if (pageData == null) {
          return null;
        }

        // add tags and seenUserCount to pageData
        pageData._doc.tags = data._source.tag_names;
        pageData._doc.seenUserCount =
          (pageData.seenUsers && pageData.seenUsers.length) || 0;

        // serialize lastUpdateUser
        if (
          pageData.lastUpdateUser != null &&
          pageData.lastUpdateUser instanceof User
        ) {
          pageData.lastUpdateUser = serializeUserSecurely(
            pageData.lastUpdateUser,
          );
        }

        // increment elasticSearchResult
        let elasticSearchResult:
          | { snippet: string | null; highlightedPath: string | null }
          | undefined;
        const highlightData = data._highlight;
        if (highlightData != null) {
          const snippet = this.canShowSnippet(pageData, user, userGroups)
            ? // eslint-disable-next-line max-len
              highlightData.body ||
              highlightData['body.en'] ||
              highlightData['body.ja'] ||
              highlightData.comments ||
              highlightData['comments.en'] ||
              highlightData['comments.ja']
            : null;
          const pathMatch =
            highlightData['path.en'] || highlightData['path.ja'];

          elasticSearchResult = {
            snippet:
              snippet != null && typeof snippet[0] === 'string'
                ? filterXss.process(snippet)
                : null,
            highlightedPath:
              pathMatch != null && typeof pathMatch[0] === 'string'
                ? filterXss.process(pathMatch)
                : null,
          };
        }

        // serialize creator
        if (pageData.creator != null && pageData.creator instanceof User) {
          pageData.creator = serializeUserSecurely(pageData.creator);
        }

        // generate pageMeta data
        const pageMeta = {
          bookmarkCount: data._source.bookmark_count || 0,
          elasticSearchResult,
        };

        return { data: pageData, meta: pageMeta };
      },
    );

    result.data = pages.filter(nonNullable);
    return result;
  }

  canShowSnippet(pageData, user, userGroups): boolean {
    const Page = mongoose.model('Page') as unknown as PageModel;

    const testGrant = pageData.grant;
    const testGrantedUser = pageData.grantedUsers?.[0];
    const testGrantedGroups = pageData.grantedGroups;

    if (testGrant === Page.GRANT_RESTRICTED) {
      return false;
    }

    if (testGrant === Page.GRANT_OWNER) {
      if (user == null) return false;

      return user._id.toString() === testGrantedUser.toString();
    }

    if (testGrant === Page.GRANT_USER_GROUP) {
      if (userGroups == null) return false;

      return hasIntersection(
        userGroups.map((id) => id.toString()),
        testGrantedGroups,
      );
    }

    return true;
  }
}

export default SearchService;
