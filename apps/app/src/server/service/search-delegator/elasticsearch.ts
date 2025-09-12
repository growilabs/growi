import { Writable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { URL } from 'url';

import { getIdStringForRef, type IPage } from '@growi/core';
import gc from 'expose-gc/function';
import mongoose from 'mongoose';

import { SearchDelegatorName } from '~/interfaces/named-query';
import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';
import { SocketEventName } from '~/interfaces/websocket';
import PageTagRelation from '~/server/models/page-tag-relation';
import loggerFactory from '~/utils/logger';

import type {
  SearchDelegator, SearchableData, QueryTerms, UnavailableTermsKey, ESQueryTerms, ESTermsKey,
} from '../../interfaces/search';
import type { PageModel } from '../../models/page';
import { createBatchStream } from '../../util/batch-stream';
import { configManager } from '../config-manager';
import type { UpdateOrInsertPagesOpts } from '../interfaces/search';
// // import { embed, openaiClient, fileUpload } from '../openai';
// import { getOrCreateSearchAssistant } from '../openai/assistant';

import { aggregatePipelineToIndex } from './aggregate-to-index';
import type { AggregatedPage, BulkWriteBody, BulkWriteCommand } from './bulk-write';
import ElasticsearchClient from './elasticsearch-client';

const logger = loggerFactory('growi:service:search-delegator:elasticsearch');

const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 50;

const { RELATION_SCORE, CREATED_AT, UPDATED_AT } = SORT_AXIS;
const { DESC, ASC } = SORT_ORDER;

const ES_SORT_AXIS = {
  [RELATION_SCORE]: '_score',
  [CREATED_AT]: 'created_at',
  [UPDATED_AT]: 'updated_at',
};
const ES_SORT_ORDER = {
  [DESC]: 'desc',
  [ASC]: 'asc',
};

const AVAILABLE_KEYS = ['match', 'not_match', 'phrase', 'not_phrase', 'prefix', 'not_prefix', 'tag', 'not_tag'];

type Data = any;

class ElasticsearchDelegator implements SearchDelegator<Data, ESTermsKey, ESQueryTerms> {

  name!: SearchDelegatorName.DEFAULT;

  socketIoService!: any;

  isElasticsearchV7: boolean;

  isElasticsearchReindexOnBoot: boolean;

  elasticsearch: any;

  client: ElasticsearchClient;

  queries: any;

  indexName: string;

  esUri: string | undefined;

  constructor(socketIoService) {
    this.name = SearchDelegatorName.DEFAULT;
    this.socketIoService = socketIoService;

    const elasticsearchVersion: number = configManager.getConfig('app:elasticsearchVersion');

    if (elasticsearchVersion !== 7 && elasticsearchVersion !== 8) {
      throw new Error('Unsupported Elasticsearch version. Please specify a valid number to \'ELASTICSEARCH_VERSION\'');
    }

    this.isElasticsearchV7 = elasticsearchVersion === 7;

    this.isElasticsearchReindexOnBoot = configManager.getConfig('app:elasticsearchReindexOnBoot');

    // In Elasticsearch RegExp, we don't need to used ^ and $.
    // Ref: https://www.elastic.co/guide/en/elasticsearch/reference/5.6/query-dsl-regexp-query.html#_standard_operators
    this.queries = {
      PORTAL: {
        regexp: {
          'path.raw': '.*/',
        },
      },
      PUBLIC: {
        regexp: {
          'path.raw': '.*[^/]',
        },
      },
      USER: {
        prefix: {
          'path.raw': '/user/',
        },
      },
    };

    this.initClient();
  }

  get aliasName() {
    return `${this.indexName}-alias`;
  }

  initClient() {
    const { host, auth, indexName } = this.getConnectionInfo();

    const rejectUnauthorized = configManager.getConfig('app:elasticsearchRejectUnauthorized');

    const options = {
      node: host,
      auth,
      requestTimeout: configManager.getConfig('app:elasticsearchRequestTimeout'),
    };

    this.client = new ElasticsearchClient(this.isElasticsearchV7, options, rejectUnauthorized);
    this.indexName = indexName;
  }

  getType(): '_doc' | undefined {
    return this.isElasticsearchV7 ? '_doc' : undefined;
  }

  /**
   * return information object to connect to ES
   * @return {object} { host, auth, indexName}
   */
  getConnectionInfo() {
    let indexName = 'crowi';
    let host = this.esUri;
    let auth;

    const elasticsearchUri = configManager.getConfig('app:elasticsearchUri');

    if (elasticsearchUri != null) {
      const url = new URL(elasticsearchUri);
      if (url.pathname !== '/') {
        host = `${url.protocol}//${url.host}`;
        indexName = url.pathname.substring(1); // omit heading slash

        if (url.username != null && url.password != null) {
          const { username, password } = url;
          auth = { username, password };
        }
      }
    }

    return {
      host,
      auth,
      indexName,
    };
  }

  async init(): Promise<void> {
    const normalizeIndices = await this.normalizeIndices();
    if (this.isElasticsearchReindexOnBoot) {
      try {
        await this.rebuildIndex();
      }
      catch (err) {
        logger.error('Rebuild index on boot failed', err);
      }
      return;
    }
    return normalizeIndices;
  }

  /**
   * return Nodes Info
   * `cluster:monitor/nodes/info` privilege is required on ES
   * @return {object} `{ esVersion, esNodeInfos }`
   *
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.6/cluster-nodes-info.html
   */
  async getInfo() {
    const info = await this.client.nodes.info();
    if (!info != null) {
      throw new Error('There is no nodes');
    }

    let esVersion = 'unknown';
    const esNodeInfos = {};

    for (const [nodeName, nodeInfo] of Object.entries<any>(info)) {
      esVersion = nodeInfo.version;

      const filteredInfo = {
        name: nodeInfo.name,
        version: nodeInfo.version,
        plugins: nodeInfo.plugins.map((pluginInfo) => {
          return {
            name: pluginInfo.name,
            version: pluginInfo.version,
          };
        }),
      };

      esNodeInfos[nodeName] = filteredInfo;
    }

    return { esVersion, esNodeInfos };
  }

  /**
   * return Cluster Health
   * `cluster:monitor/health` privilege is required on ES
   * @return {object} `{ esClusterHealth }`
   *
   * @see https://www.elastic.co/guide/en/elasticsearch/reference/6.6/cluster-health.html
   */
  async getInfoForHealth() {
    const esClusterHealth = await this.client.cluster.health();
    return { esClusterHealth };
  }

  /**
   * Return information for Admin Full Text Search Management page
   */
  async getInfoForAdmin() {
    const { client, indexName, aliasName } = this;

    const tmpIndexName = `${indexName}-tmp`;

    // check existence
    const isExistsMainIndex = await client.indices.exists({ index: indexName });
    const isExistsTmpIndex = await client.indices.exists({ index: tmpIndexName });

    // create indices name list
    const existingIndices: string[] = [];
    if (isExistsMainIndex) { existingIndices.push(indexName) }
    if (isExistsTmpIndex) { existingIndices.push(tmpIndexName) }

    // results when there is no indices
    if (existingIndices.length === 0) {
      return {
        indices: [],
        aliases: [],
        isNormalized: false,
      };
    }

    const indicesStats = await client.indices.stats({ index: existingIndices, metric: ['docs', 'store', 'indexing'] });
    const { indices } = indicesStats;

    const aliases = await client.indices.getAlias({ index: existingIndices });

    const isMainIndexHasAlias = isExistsMainIndex && aliases[indexName].aliases != null && aliases[indexName].aliases[aliasName] != null;
    const isTmpIndexHasAlias = isExistsTmpIndex && aliases[tmpIndexName].aliases != null && aliases[tmpIndexName].aliases[aliasName] != null;

    const isNormalized = isExistsMainIndex && isMainIndexHasAlias && !isExistsTmpIndex && !isTmpIndexHasAlias;

    return {
      indices,
      aliases,
      isNormalized,
    };

  }

  /**
   * rebuild index
   */
  async rebuildIndex() {
    const { client, indexName, aliasName } = this;

    const tmpIndexName = `${indexName}-tmp`;

    try {
      // reindex to tmp index
      await this.createIndex(tmpIndexName);
      await client.reindex(indexName, tmpIndexName);

      // update alias
      await client.indices.updateAliases({
        body: {
          actions: [
            { add: { alias: aliasName, index: tmpIndexName } },
            { remove: { alias: aliasName, index: indexName } },
          ],
        },
      });

      // flush index
      await client.indices.delete({
        index: indexName,
      });
      await this.createIndex(indexName);
      await this.addAllPages();
    }
    catch (error) {
      logger.error('An error occured while \'rebuildIndex\'.', error);
      logger.error('error.meta.body', error?.meta?.body);

      const socket = this.socketIoService.getAdminSocket();
      socket.emit(SocketEventName.RebuildingFailed, { error: error.message });

      throw error;
    }
    finally {
      logger.info('Normalize indices.');
      await this.normalizeIndices();
    }

  }

  async normalizeIndices() {
    const { client, indexName, aliasName } = this;

    const tmpIndexName = `${indexName}-tmp`;

    // remove tmp index
    const isExistsTmpIndex = await client.indices.exists({ index: tmpIndexName });
    if (isExistsTmpIndex) {
      await client.indices.delete({ index: tmpIndexName });
    }

    // create index
    const isExistsIndex = await client.indices.exists({ index: indexName });
    if (!isExistsIndex) {
      await this.createIndex(indexName);
    }

    // create alias
    const isExistsAlias = await client.indices.existsAlias({ name: aliasName, index: indexName });
    if (!isExistsAlias) {
      await client.indices.putAlias({
        name: aliasName,
        index: indexName,
      });
    }
  }

  async createIndex(index) {
    let mappings = this.isElasticsearchV7
      ? require('^/resource/search/mappings-es7.json')
      : require('^/resource/search/mappings-es8.json');

    if (process.env.CI) {
      mappings = require('^/resource/search/mappings-es8-for-ci.json');
    }

    return this.client.indices.create({
      index,
      body: mappings,
    });
  }

  /**
   * generate object that is related to page.grant*
   */
  generateDocContentsRelatedToRestriction(page: AggregatedPage) {
    const grantedUserIds = page.grantedUsers.map(user => getIdStringForRef(user));
    const grantedGroupIds = page.grantedGroups.map(group => getIdStringForRef(group.item));

    return {
      grant: page.grant,
      granted_users: grantedUserIds,
      granted_groups: grantedGroupIds,
    };
  }

  prepareBodyForCreate(page: AggregatedPage): [BulkWriteCommand, BulkWriteBody] {

    const command = {
      index: {
        _index: this.indexName,
        _type: this.getType(),
        _id: page._id.toString(),
      },
    };

    const document: BulkWriteBody = {
      path: page.path,
      body: page.revision.body,
      body_embedded: page.revisionBodyEmbedded,
      username: page.creator?.username,
      comments: page.commentsCount > 0 ? page.comments : undefined,
      comment_count: page.commentsCount,
      bookmark_count: page.bookmarksCount,
      like_count: page.likeCount,
      seenUsers_count: page.seenUsersCount,
      created_at: page.createdAt,
      updated_at: page.updatedAt,
      tag_names: page.tagNames,
      ...this.generateDocContentsRelatedToRestriction(page),
    };

    return [command, document];
  }

  prepareBodyForDelete(body, page) {
    if (!Array.isArray(body)) {
      throw new Error('Body must be an array.');
    }

    const command = {
      delete: {
        _index: this.indexName,
        _type: this.getType(),
        _id: page._id.toString(),
      },
    };

    body.push(command);
  }

  addAllPages() {
    const Page = mongoose.model('Page');
    return this.updateOrInsertPages(() => Page.find(), { shouldEmitProgress: true, invokeGarbageCollection: true });
  }

  updateOrInsertPageById(pageId) {
    const Page = mongoose.model('Page');
    return this.updateOrInsertPages(() => Page.findById(pageId));
  }

  updateOrInsertDescendantsPagesById(page, user) {
    const Page = mongoose.model('Page') as unknown as PageModel;
    const { PageQueryBuilder } = Page;
    const builder = new PageQueryBuilder(Page.find());
    builder.addConditionToListWithDescendants(page.path);
    return this.updateOrInsertPages(() => builder.query);
  }

  /**
   * @param {function} queryFactory factory method to generate a Mongoose Query instance
   */
  async updateOrInsertPages(queryFactory, option: UpdateOrInsertPagesOpts = {}) {
    const { shouldEmitProgress = false, invokeGarbageCollection = false } = option;

    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    const socket = shouldEmitProgress ? this.socketIoService.getAdminSocket() : null;

    // prepare functions invoked from custom streams
    const prepareBodyForCreate = this.prepareBodyForCreate.bind(this);
    const bulkWrite = this.client.bulk.bind(this.client);

    const matchQuery = new PageQueryBuilder(queryFactory()).query;

    const countQuery = new PageQueryBuilder(queryFactory()).query;
    const totalCount = await countQuery.count();

    const maxBodyLengthToIndex = configManager.getConfig('app:elasticsearchMaxBodyLengthToIndex');

    const readStream = Page.aggregate<AggregatedPage>(
      aggregatePipelineToIndex(maxBodyLengthToIndex, matchQuery),
    ).cursor();

    const bulkSize: number = configManager.getConfig('app:elasticsearchReindexBulkSize');
    const batchStream = createBatchStream(bulkSize);

    const appendTagNamesStream = new Transform({
      objectMode: true,
      async transform(chunk, encoding, callback) {
        const pageIds = chunk.map(doc => doc._id);

        const idToTagNamesMap = await PageTagRelation.getIdToTagNamesMap(pageIds);
        const idsHavingTagNames = Object.keys(idToTagNamesMap);

        // append tagNames
        chunk
          .filter(doc => idsHavingTagNames.includes(doc._id.toString()))
          .forEach((doc: AggregatedPage) => {
            // append tagName from idToTagNamesMap
            doc.tagNames = idToTagNamesMap[doc._id.toString()];
          });

        this.push(chunk);
        callback();
      },
    });

    // const appendEmbeddingStream = new Transform({
    //   objectMode: true,
    //   async transform(chunk: AggregatedPage[], encoding, callback) {
    //     // append embedding
    //     for await (const doc of chunk) {
    //       doc.revisionBodyEmbedded = (await embed(doc.revision.body, doc.creator?.username))[0].embedding;
    //     }

    //     this.push(chunk);
    //     callback();
    //   },
    // });

    // const appendFileUploadedStream = new Transform({
    //   objectMode: true,
    //   async transform(chunk, encoding, callback) {
    //     await fileUpload(chunk);
    //     this.push(chunk);
    //     callback();
    //   },
    // });

    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        const body: (BulkWriteCommand|BulkWriteBody)[] = [];
        batch.forEach((doc: AggregatedPage) => {
          body.push(...prepareBodyForCreate(doc));
        });

        try {
          const bulkResponse = await bulkWrite({
            body,
            // requestTimeout: Infinity,
          });

          count += (bulkResponse.items || []).length;

          logger.info(`Adding pages progressing: (count=${count}, errors=${bulkResponse.errors}, took=${bulkResponse.took}ms)`);

          if (shouldEmitProgress) {
            socket?.emit(SocketEventName.AddPageProgress, { totalCount, count });
          }
        }
        catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        if (invokeGarbageCollection) {
          try {
            // First aid to prevent unexplained memory leaks
            logger.info('global.gc() invoked.');
            gc();
          }
          catch (err) {
            logger.error('fail garbage collection: ', err);
          }
        }

        callback();
      },
      final(callback) {
        logger.info(`Adding pages has completed: (totalCount=${totalCount})`);

        if (shouldEmitProgress) {
          socket?.emit(SocketEventName.FinishAddPage, { totalCount, count });
        }
        callback();
      },
    });


    return pipeline(
      readStream,
      batchStream,
      appendTagNamesStream,
      // appendEmbeddingStream,
      // appendFileUploadedStream,
      writeStream,
    );
  }

  deletePages(pages) {
    const body = [];
    pages.forEach(page => this.prepareBodyForDelete(body, page));

    logger.debug('deletePages(): Sending Request to ES', body);
    return this.client.bulk({
      body,
    });
  }

  /**
   * search returning type:
   * {
   *   meta: { total: Integer, results: Integer},
   *   data: [ pages ...],
   * }
   */
  async searchKeyword(query): Promise<ISearchResult<ISearchResultData>> {

    // for debug
    if (process.env.NODE_ENV === 'development') {
      logger.debug('query: ', JSON.stringify(query, null, 2));

      const validateQueryResponse = await this.client.indices.validateQuery({
        index: query.index,
        type: query.type,
        explain: true,
        body: {
          query: query.body.query,
        },
      });

      // for debug
      logger.debug('ES result: ', validateQueryResponse);
    }

    const searchResponse = await this.client.search(query);

    const _total = searchResponse?.hits?.total;
    let total = 0;
    if (typeof _total === 'object') {
      total = _total.value;
    }

    return {
      meta: {
        total,
        took: searchResponse.took,
        hitsCount: searchResponse.hits.hits.length,
      },
      data: searchResponse.hits.hits.map((elm) => {
        return {
          _id: elm._id,
          _score: elm._score,
          _source: elm._source,
          _highlight: elm.highlight,
        };
      }),
    };
  }

  /**
   * create search query for Elasticsearch
   *
   * @param {object | undefined} option optional paramas
   * @returns {object} query object
   */
  createSearchQuery(option?) {
    let fields = ['path', 'bookmark_count', 'comment_count', 'seenUsers_count', 'updated_at', 'tag_names', 'comments'];
    if (option) {
      fields = option.fields || fields;
    }

    // sort by score
    // eslint-disable-next-line prefer-const
    let query = {
      index: this.aliasName,
      _source: fields,
      body: {
        query: {}, // query
      },
    };

    return query;
  }

  appendResultSize(query, from?, size?) {
    query.from = from || DEFAULT_OFFSET;
    query.size = size || DEFAULT_LIMIT;
  }

  appendSortOrder(query, sortAxis: SORT_AXIS, sortOrder: SORT_ORDER) {
    // default sort order is score descending
    const sort = ES_SORT_AXIS[sortAxis] || ES_SORT_AXIS[RELATION_SCORE];
    const order = ES_SORT_ORDER[sortOrder] || ES_SORT_ORDER[DESC];
    query.body.sort = { [sort]: { order } };
  }

  initializeBoolQuery(query) {
    // query is created by createSearchQuery()
    if (!query.body.query.bool) {
      query.body.query.bool = {};
    }

    const isInitialized = (query) => { return !!query && Array.isArray(query) };

    if (!isInitialized(query.body.query.bool.filter)) {
      query.body.query.bool.filter = [];
    }
    if (!isInitialized(query.body.query.bool.must)) {
      query.body.query.bool.must = [];
    }
    if (!isInitialized(query.body.query.bool.must_not)) {
      query.body.query.bool.must_not = [];
    }
    return query;
  }

  appendCriteriaForQueryString(query, parsedKeywords: ESQueryTerms): void {
    query = this.initializeBoolQuery(query); // eslint-disable-line no-param-reassign

    if (parsedKeywords.match.length > 0) {
      const q = {
        multi_match: {
          query: parsedKeywords.match.join(' '),
          type: 'most_fields',
          fields: ['path.ja^2', 'path.en^2', 'body.ja', 'body.en', 'comments.ja', 'comments.en'],
        },
      };
      query.body.query.bool.must.push(q);
    }

    if (parsedKeywords.not_match.length > 0) {
      const q = {
        multi_match: {
          query: parsedKeywords.not_match.join(' '),
          fields: ['path.ja', 'path.en', 'body.ja', 'body.en', 'comments.ja', 'comments.en'],
          operator: 'or',
        },
      };
      query.body.query.bool.must_not.push(q);
    }

    if (parsedKeywords.phrase.length > 0) {
      parsedKeywords.phrase.forEach((phrase) => {
        const phraseQuery = {
          multi_match: {
            query: phrase, // each phrase is quoteted words like "This is GROWI"
            type: 'phrase',
            fields: [
              // Not use "*.ja" fields here, because we want to analyze (parse) search words
              'path.raw^2',
              'body',
              'comments',
            ],
          },
        };
        query.body.query.bool.must.push(phraseQuery);
      });
    }

    if (parsedKeywords.not_phrase.length > 0) {
      parsedKeywords.not_phrase.forEach((phrase) => {
        const notPhraseQuery = {
          multi_match: {
            query: phrase, // each phrase is quoteted words
            type: 'phrase',
            fields: [
              // Not use "*.ja" fields here, because we want to analyze (parse) search words
              'path.raw^2',
              'body',
            ],
          },
        };
        query.body.query.bool.must_not.push(notPhraseQuery);
      });
    }

    if (parsedKeywords.prefix.length > 0) {
      const queries = parsedKeywords.prefix.map((path) => {
        return { prefix: { 'path.raw': path } };
      });
      query.body.query.bool.filter.push({ bool: { should: queries } });
    }

    if (parsedKeywords.not_prefix.length > 0) {
      const queries = parsedKeywords.not_prefix.map((path) => {
        return { prefix: { 'path.raw': path } };
      });
      query.body.query.bool.filter.push({ bool: { must_not: queries } });
    }

    if (parsedKeywords.tag.length > 0) {
      const queries = parsedKeywords.tag.map((tag) => {
        return { term: { tag_names: tag } };
      });
      query.body.query.bool.filter.push({ bool: { must: queries } });
    }

    if (parsedKeywords.not_tag.length > 0) {
      const queries = parsedKeywords.not_tag.map((tag) => {
        return { term: { tag_names: tag } };
      });
      query.body.query.bool.filter.push({ bool: { must_not: queries } });
    }
  }

  async filterPagesByViewer(query, user, userGroups) {
    const showPagesRestrictedByOwner = !configManager.getConfig('security:list-policy:hideRestrictedByOwner');
    const showPagesRestrictedByGroup = !configManager.getConfig('security:list-policy:hideRestrictedByGroup');

    query = this.initializeBoolQuery(query); // eslint-disable-line no-param-reassign

    const Page = mongoose.model('Page') as unknown as PageModel;
    const {
      GRANT_PUBLIC, GRANT_SPECIFIED, GRANT_OWNER, GRANT_USER_GROUP,
    } = Page;

    const grantConditions: any[] = [
      { term: { grant: GRANT_PUBLIC } },
    ];

    if (showPagesRestrictedByOwner) {
      grantConditions.push(
        { term: { grant: GRANT_SPECIFIED } },
        { term: { grant: GRANT_OWNER } },
      );
    }
    else if (user != null) {
      grantConditions.push(
        {
          bool: {
            must: [
              { term: { grant: GRANT_SPECIFIED } },
              { term: { granted_users: user._id.toString() } },
            ],
          },
        },
        {
          bool: {
            must: [
              { term: { grant: GRANT_OWNER } },
              { term: { granted_users: user._id.toString() } },
            ],
          },
        },
      );
    }

    if (showPagesRestrictedByGroup) {
      grantConditions.push(
        { term: { grant: GRANT_USER_GROUP } },
      );
    }
    else if (userGroups != null && userGroups.length > 0) {
      const userGroupIds = userGroups.map((group) => { return group._id.toString() });
      grantConditions.push(
        {
          bool: {
            must: [
              { term: { grant: GRANT_USER_GROUP } },
              { terms: { granted_groups: userGroupIds } },
            ],
          },
        },
      );
    }

    query.body.query.bool.filter.push({ bool: { should: grantConditions } });
  }

  async appendFunctionScore(query, queryString) {
    const User = mongoose.model('User');
    const count = await User.count({}) || 1;

    const minScore = queryString.length * 0.1 - 1; // increase with length
    logger.debug('min_score: ', minScore);

    query.body.query = {
      function_score: {
        query: { ...query.body.query },
        // // disable min_score -- 2019.02.28 Yuki Takei
        // // more precise adjustment is needed...
        // min_score: minScore,
        field_value_factor: {
          field: 'bookmark_count',
          modifier: 'log1p',
          factor: 10000 / count,
          missing: 0,
        },
        boost_mode: 'sum',
      },
    };
  }

  // async appendVectorScore(query, queryString: string, username?: string): Promise<void> {

  //   const searchAssistant = await getOrCreateSearchAssistant();

  //   // generate keywords for vector
  //   const run = await openaiClient.beta.threads.createAndRunPoll({
  //     assistant_id: searchAssistant.id,
  //     thread: {
  //       messages: [
  //         { role: 'user', content: 'globalLang: "en_US", userLang: "ja_JP", user_input: "武井さんがジョインしたのはいつですか？"' },
  //         { role: 'assistant', content: '武井さん 武井 takei yuki ジョイン join 入社 加入 雇用開始 年月日 start date join employee' },
  //         { role: 'user', content: `globalLang: "en_US", userLang: "ja_JP", user_input: "${queryString}"` },
  //       ],
  //     },
  //   });
  //   const messages = await openaiClient.beta.threads.messages.list(run.thread_id, {
  //     limit: 1,
  //   });
  //   const content = messages.data[0].content[0];
  //   const keywordsForVector = content.type === 'text' ? content.text.value : queryString;

  //   logger.debug('keywordsFor: ', keywordsForVector);

  //   const queryVector = (await embed(queryString, username))[0].embedding;

  //   query.body.query = {
  //     script_score: {
  //       query: { ...query.body.query },
  //       script: {
  //         source: "cosineSimilarity(params.query_vector, 'body_embedded') + 1.0",
  //         params: { query_vector: queryVector },
  //       },
  //     },
  //   };
  // }

  appendHighlight(query) {
    query.body.highlight = {
      fragmenter: 'simple',
      pre_tags: ["<em class='highlighted-keyword'>"],
      post_tags: ['</em>'],
      fields: {
        '*': {
          fragment_size: 40,
        },
        'path.*': {
          // No fragments are generated
          // see: https://www.elastic.co/guide/en/elasticsearch/reference/current/highlighting.html#highlighting-settings
          number_of_fragments: 0,
        },
      },
      max_analyzed_offset: 1000000 - 1, // Set the query parameter [max_analyzed_offset] to a value less than index setting [1000000] and this will tolerate long field values by truncating them.
    };
  }

  async search(data: SearchableData<ESQueryTerms>, user, userGroups, option?): Promise<ISearchResult<ISearchResultData>> {
    const { queryString, terms } = data;

    if (terms == null) {
      throw Error('Cannot process search since terms is undefined.');
    }

    const from = option?.offset ?? null;
    const size = option?.limit ?? null;
    const sort = option?.sort ?? null;
    const order = option?.order ?? null;

    const query = this.createSearchQuery();

    if (option?.vector) {
      // await this.filterPagesByViewer(query, user, userGroups);
      // await this.appendVectorScore(query, queryString, user?.username);
    }
    else {
      this.appendCriteriaForQueryString(query, terms);
      await this.filterPagesByViewer(query, user, userGroups);
      await this.appendFunctionScore(query, queryString);
    }

    this.appendResultSize(query, from, size);

    this.appendSortOrder(query, sort, order);

    this.appendHighlight(query);

    return this.searchKeyword(query);
  }

  isTermsNormalized(terms: Partial<QueryTerms>): terms is ESQueryTerms {
    const entries = Object.entries(terms);

    return !entries.some(([key, val]) => !AVAILABLE_KEYS.includes(key) && typeof val?.length === 'number' && val.length > 0);
  }

  validateTerms(terms: QueryTerms): UnavailableTermsKey<ESTermsKey>[] {
    const entries = Object.entries(terms);

    return entries
      .filter(([key, val]) => !AVAILABLE_KEYS.includes(key) && val.length > 0)
      .map(([key]) => key as UnavailableTermsKey<ESTermsKey>);
  }

  async syncPageUpdated(page, user) {
    logger.debug('SearchClient.syncPageUpdated', page.path);
    return this.updateOrInsertPageById(page._id);
  }

  // remove pages whitch should nod Indexed
  async syncPagesUpdated(pages, user) {
    const shoudDeletePages: any[] = [];

    // delete if page should not indexed
    try {
      if (shoudDeletePages.length !== 0) {
        await this.deletePages(shoudDeletePages);
      }
    }
    catch (err) {
      logger.error('deletePages:ES Error', err);
    }
  }

  async syncDescendantsPagesUpdated(parentPage, user) {
    return this.updateOrInsertDescendantsPagesById(parentPage, user);
  }

  async syncDescendantsPagesDeleted(pages, user) {
    for (let i = 0; i < pages.length; i++) {
      logger.debug('SearchClient.syncDescendantsPagesDeleted', pages[i].path);
    }

    try {
      return await this.deletePages(pages);
    }
    catch (err) {
      logger.error('deletePages:ES Error', err);
    }
  }

  async syncPageDeleted(page, user) {
    logger.debug('SearchClient.syncPageDeleted', page.path);

    try {
      return await this.deletePages([page]);
    }
    catch (err) {
      logger.error('deletePages:ES Error', err);
    }
  }

  async syncBookmarkChanged(pageId) {
    logger.debug('SearchClient.syncBookmarkChanged', pageId);

    return this.updateOrInsertPageById(pageId);
  }

  async syncCommentChanged(comment) {
    logger.debug('SearchClient.syncCommentChanged', comment);

    return this.updateOrInsertPageById(comment.page);
  }

  async syncTagChanged(page) {
    logger.debug('SearchClient.syncTagChanged', page.path);

    return this.updateOrInsertPageById(page._id);
  }

}

export default ElasticsearchDelegator;
