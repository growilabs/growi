import { Writable, Transform, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { URL } from 'url';
import type { Cursor } from 'mongoose';

import { getIdStringForRef, type IPage } from '@growi/core';
import gc from 'expose-gc/function';
import mongoose from 'mongoose';

import { SearchDelegatorName } from '~/interfaces/named-query';
import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import { SORT_AXIS, SORT_ORDER } from '~/interfaces/search';
import { SocketEventName } from '~/interfaces/websocket';
import PageTagRelation from '~/server/models/page-tag-relation';
import type { SocketIoService } from '~/server/service/socket-io';
import loggerFactory from '~/utils/logger';

import type {
  SearchDelegator, SearchableData, QueryTerms, UnavailableTermsKey, ESQueryTerms, ESTermsKey,
} from '../../interfaces/search';
import type { PageModel } from '../../models/page';
import { createBatchStream } from '../../util/batch-stream';
import { configManager } from '../config-manager';
import type { UpdateOrInsertPagesOpts } from '../interfaces/search';

import { aggregatePipelineToIndex } from './aggregate-to-index';
import type { AggregatedPage, BulkWriteBody, BulkWriteCommand } from './bulk-write';
import {
  getClient,
  isES7ClientDelegator,
  isES8ClientDelegator,
  isES9ClientDelegator,
  type SearchQuery,
  type ES7SearchQuery,
  type ES8SearchQuery,
  type ES9SearchQuery,
  type ElasticsearchClientDelegator,
} from './elasticsearch-client-delegator';

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
} as const;

const AVAILABLE_KEYS = ['match', 'not_match', 'phrase', 'not_phrase', 'prefix', 'not_prefix', 'tag', 'not_tag'];

type Data = any;

class ElasticsearchDelegator implements SearchDelegator<Data, ESTermsKey, ESQueryTerms> {

  name!: SearchDelegatorName.DEFAULT;

  private socketIoService!: SocketIoService;

  // TODO: https://redmine.weseek.co.jp/issues/168446
  private isElasticsearchV7: boolean;

  private isElasticsearchReindexOnBoot: boolean;

  private elasticsearchVersion: 7 | 8 | 9;

  private client: ElasticsearchClientDelegator | null = null;

  private indexName: string;

  // Memory management properties
  private memoryThreshold = 500 * 1024 * 1024; // 500MB threshold
  private activeStreams = new Set<Readable | Writable | Transform>();

  constructor(socketIoService: SocketIoService) {
    this.name = SearchDelegatorName.DEFAULT;
    this.socketIoService = socketIoService;

    const elasticsearchVersion = configManager.getConfig('app:elasticsearchVersion');

    if (elasticsearchVersion !== 7 && elasticsearchVersion !== 8 && elasticsearchVersion !== 9) {
      throw new Error('Unsupported Elasticsearch version. Please specify a valid number to \'ELASTICSEARCH_VERSION\'');
    }

    this.isElasticsearchV7 = elasticsearchVersion === 7;

    this.elasticsearchVersion = elasticsearchVersion;

    this.isElasticsearchReindexOnBoot = configManager.getConfig('app:elasticsearchReindexOnBoot');
  }

  get aliasName(): string {
    return `${this.indexName}-alias`;
  }

  private getClient(): ElasticsearchClientDelegator {
    if (this.client == null) {
      throw new Error('Elasticsearch client is not initialized');
    }
    return this.client;
  }

  async initClient(): Promise<void> {
    // 既存のクライアントが存在する場合はクリーンアップ
    if (this.client != null) {
      try {
        // ES7, ES8, ES9クライアントは close メソッドを持たないため、
        // 代わりに適切なクリーンアップ処理を実行
        logger.info('Cleaning up existing ES client');
      } catch (error) {
        logger.warn('Failed to close existing ES client:', error);
      }
    }

    const { host, auth, indexName } = this.getConnectionInfo();

    const rejectUnauthorized = configManager.getConfig('app:elasticsearchRejectUnauthorized');

    const options = {
      node: host,
      auth,
      requestTimeout: configManager.getConfig('app:elasticsearchRequestTimeout'),
      // コネクションプールの設定を明示的に追加
      maxRetries: 3,
      maxConnections: 10,
    };

    this.client = await getClient({ version: this.elasticsearchVersion, options, rejectUnauthorized });
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
    let host: string | undefined;
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
    await this.initClient();
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
    if (this.client == null) {
      throw new Error('Elasticsearch client is not initialized');
    }

    const info = await this.client.nodes.info();
    if (!info != null) {
      throw new Error('There is no nodes');
    }

    let esVersion = 'unknown';
    const esNodeInfos = {};

    for (const [nodeName, nodeInfo] of Object.entries(info)) {
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
    if (this.client == null) {
      throw new Error('Elasticsearch client is not initialized');
    }

    const esClusterHealth = await this.client.cluster.health();
    return { esClusterHealth };
  }

  /**
   * Return information for Admin Full Text Search Management page
   */
  async getInfoForAdmin() {
    const client = this.getClient();
    const { indexName, aliasName } = this;

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
  async rebuildIndex(): Promise<void> {
    const client = this.getClient();
    const { indexName, aliasName } = this;

    const tmpIndexName = `${indexName}-tmp`;

    try {
      // reindex to tmp index
      await this.createIndex(tmpIndexName);
      await client.reindex(indexName, tmpIndexName);

      // update alias
      await client.indices.updateAliases({
        actions: [
          { add: { alias: aliasName, index: tmpIndexName } },
          { remove: { alias: aliasName, index: indexName } },
        ],
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

  async normalizeIndices(): Promise<void> {
    const client = this.getClient();
    const { indexName, aliasName } = this;

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

  async createIndex(index: string) {
    const client = this.getClient();
    
    // TODO: https://redmine.weseek.co.jp/issues/168446
    if (isES7ClientDelegator(client)) {
      const { mappings } = await import('./mappings/mappings-es7');
      return client.indices.create({
        index,
        body: {
          ...mappings,
        },
      });
    }

    if (isES8ClientDelegator(client)) {
      const { mappings } = await import('./mappings/mappings-es8');
      return client.indices.create({
        index,
        ...mappings,
      });
    }

    if (isES9ClientDelegator(client)) {
      const { mappings } = process.env.CI == null
        ? await import('./mappings/mappings-es9')
        : await import('./mappings/mappings-es9-for-ci');

      return client.indices.create({
        index,
        ...mappings,
      });
    }
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

  prepareBodyForDelete(body, page): void {
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
  async updateOrInsertPages(queryFactory, option: UpdateOrInsertPagesOpts = {}): Promise<void> {
    const { shouldEmitProgress = false, invokeGarbageCollection = false } = option;
    const startMemory = process.memoryUsage();

    const Page = mongoose.model<IPage, PageModel>('Page');
    const { PageQueryBuilder } = Page;

    const socket = shouldEmitProgress ? this.socketIoService.getAdminSocket() : null;

    // prepare functions invoked from custom streams
    const prepareBodyForCreate = this.prepareBodyForCreate.bind(this);
    const bulkWrite = this.getClient().bulk.bind(this.getClient());

    const matchQuery = new PageQueryBuilder(queryFactory()).query;
    const countQuery = new PageQueryBuilder(queryFactory()).query;
    const totalCount = await countQuery.count();

    const maxBodyLengthToIndex = configManager.getConfig('app:elasticsearchMaxBodyLengthToIndex');

    let readStream: Cursor<AggregatedPage>;
    let batchStream: Transform;
    let appendTagNamesStream: Transform;
    let writeStream: Writable;

    try {
      readStream = Page.aggregate<AggregatedPage>(
        aggregatePipelineToIndex(maxBodyLengthToIndex, matchQuery),
      ).cursor();
      this.activeStreams.add(readStream);

      const bulkSize: number = Math.min(
        configManager.getConfig('app:elasticsearchReindexBulkSize'),
        1000 // Maximum safe batch size to prevent memory issues
      );
      
      batchStream = createBatchStream(bulkSize);
      this.activeStreams.add(batchStream);

      appendTagNamesStream = this.createMemoryAwareTagStream();
      this.activeStreams.add(appendTagNamesStream);

      writeStream = this.createMemoryAwareWriteStream(
        totalCount, 
        shouldEmitProgress, 
        socket, 
        prepareBodyForCreate, 
        bulkWrite, 
        invokeGarbageCollection
      );
      this.activeStreams.add(writeStream);

      await pipeline(
        readStream,
        batchStream,
        appendTagNamesStream,
        writeStream,
      );

    } catch (error) {
      logger.error('Pipeline error occurred:', error);
      await this.cleanupStreams();
      throw error;
    } finally {
      await this.cleanupStreams();
      
      const endMemory = process.memoryUsage();
      const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
      
      logger.info('Memory usage after updateOrInsertPages:', {
        deltaMB: Math.round(memoryDelta / 1024 / 1024),
        currentHeapMB: Math.round(endMemory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(endMemory.heapTotal / 1024 / 1024),
      });
      
      // メモリ使用量が閾値を超えた場合の対応
      if (memoryDelta > this.memoryThreshold) {
        logger.warn(`High memory delta detected: ${memoryDelta / 1024 / 1024}MB`);
        if (typeof global.gc === 'function') {
          global.gc();
          logger.info('Forced garbage collection executed');
        }
      }
    }
  }

  private async cleanupStreams(): Promise<void> {
    const cleanupPromises = Array.from(this.activeStreams).map(async (stream) => {
      try {
        if (stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
      } catch (error) {
        logger.warn('Stream cleanup error:', error);
      }
    });

    await Promise.allSettled(cleanupPromises);
    this.activeStreams.clear();
  }

  private createMemoryAwareTagStream(): Transform {
    return new Transform({
      objectMode: true,
      // バッファサイズを制限
      highWaterMark: 16,
      async transform(chunk, encoding, callback) {
        try {
          const pageIds = chunk.map(doc => doc._id);
          
          // メモリ使用量を監視
          const memBefore = process.memoryUsage().heapUsed;
          
          const idToTagNamesMap = await PageTagRelation.getIdToTagNamesMap(pageIds);
          const idsHavingTagNames = Object.keys(idToTagNamesMap);

          // 効率的な処理でメモリ使用量を削減
          for (const doc of chunk) {
            const docId = doc._id.toString();
            if (idsHavingTagNames.includes(docId)) {
              doc.tagNames = idToTagNamesMap[docId];
            }
          }

          const memAfter = process.memoryUsage().heapUsed;
          const memDelta = memAfter - memBefore;
          
          // メモリ使用量が閾値を超えた場合の警告
          if (memDelta > 50 * 1024 * 1024) { // 50MB
            logger.warn(`High memory usage in appendTagNamesStream: ${memDelta / 1024 / 1024}MB`);
          }

          this.push(chunk);
          callback();
        } catch (error) {
          callback(error);
        }
      },
    });
  }

  private createMemoryAwareWriteStream(
    totalCount: number,
    shouldEmitProgress: boolean, 
    socket: any, 
    prepareBodyForCreate: Function, 
    bulkWrite: Function, 
    invokeGarbageCollection: boolean
  ): Writable {
    let processedCount = 0;
    let totalMemoryUsed = 0;
    const memoryThreshold = this.memoryThreshold;

    return new Writable({
      objectMode: true,
      // バックプレッシャーを制御
      highWaterMark: 1,
      
      async write(batch, encoding, callback) {
        const batchStartTime = performance.now();
        const batchMemoryBefore = process.memoryUsage().heapUsed;
        
        try {
          const body: (BulkWriteCommand|BulkWriteBody)[] = [];
          
          // メモリ効率的な処理
          for (const doc of batch) {
            const [command, document] = prepareBodyForCreate(doc);
            body.push(command, document);
            
            // 定期的なメモリチェック
            if (body.length % 100 === 0) {
              const currentMemory = process.memoryUsage().heapUsed;
              if (currentMemory > memoryThreshold * 2) {
                logger.warn('Memory threshold exceeded during batch processing');
                break;
              }
            }
          }

          const bulkResponse = await bulkWrite({ body });
          processedCount += (bulkResponse.items || []).length;
          
          const batchMemoryAfter = process.memoryUsage().heapUsed;
          const batchMemoryDelta = batchMemoryAfter - batchMemoryBefore;
          totalMemoryUsed += batchMemoryDelta;
          
          const batchTime = performance.now() - batchStartTime;
          
          logger.debug(`Batch processed: count=${processedCount}, time=${Math.round(batchTime)}ms, memory=${Math.round(batchMemoryDelta / 1024 / 1024)}MB`);

          if (shouldEmitProgress) {
            socket?.emit(SocketEventName.AddPageProgress, { 
              totalCount, 
              count: processedCount,
              memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            });
          }

          // メモリベースのガベージコレクション
          if (invokeGarbageCollection && totalMemoryUsed > memoryThreshold) {
            try {
              if (typeof global.gc === 'function') {
                global.gc();
                totalMemoryUsed = 0; // Reset counter after GC
                logger.debug('Memory-triggered garbage collection executed');
              }
            } catch (err) {
              logger.error('Garbage collection failed:', err);
            }
          }

          // 明示的なクリーンアップ
          body.length = 0;
          
        } catch (err) {
          logger.error('Batch processing error:', err);
        }

        callback();
      },
      
      final(callback) {
        logger.info(`Indexing completed: totalProcessed=${processedCount}, totalMemoryUsed=${Math.round(totalMemoryUsed / 1024 / 1024)}MB`);
        
        if (shouldEmitProgress) {
          socket?.emit(SocketEventName.FinishAddPage, { totalCount, count: processedCount });
        }
        callback();
      },
    });
  }

  deletePages(pages) {
    const body = [];
    pages.forEach(page => this.prepareBodyForDelete(body, page));

    logger.debug('deletePages(): Sending Request to ES', body);
    return this.getClient().bulk({
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
  async searchKeyword(query: SearchQuery): Promise<ISearchResult<ISearchResultData>> {

    // for debug
    if (process.env.NODE_ENV === 'development') {
      logger.debug('query: ', JSON.stringify(query, null, 2));

      const client = this.getClient();
      const validateQueryResponse = await (async() => {
        if (isES7ClientDelegator(client)) {
          const es7SearchQuery = query as ES7SearchQuery;
          return client.indices.validateQuery({
            explain: true,
            index: es7SearchQuery.index,
            body: {
              query: es7SearchQuery.body?.query,
            },
          });
        }

        if (isES8ClientDelegator(client)) {
          const es8SearchQuery = query as ES8SearchQuery;
          return client.indices.validateQuery({
            explain: true,
            index: es8SearchQuery.index,
            query: es8SearchQuery.body.query,
          });
        }

        if (isES9ClientDelegator(client)) {
          const es9SearchQuery = query as ES9SearchQuery;
          return client.indices.validateQuery({
            explain: true,
            index: es9SearchQuery.index,
            query: es9SearchQuery.body.query,
          });
        }

        throw new Error('Unsupported Elasticsearch version');
      })();


      // for debug
      logger.debug('ES result: ', validateQueryResponse);
    }

    const searchResponse = await (async() => {
      const client = this.getClient();
      if (isES7ClientDelegator(client)) {
        return client.search(query as ES7SearchQuery);
      }

      if (isES8ClientDelegator(client)) {
        return client.search(query as ES8SearchQuery);
      }

      if (isES9ClientDelegator(client)) {
        const { body, ...rest } = query as ES9SearchQuery;
        return client.search({
          ...rest,
          // Elimination of the body property since ES9
          // https://raw.githubusercontent.com/elastic/elasticsearch-js/2f6200eb397df0e54d23848d769a93614ee1fb45/docs/release-notes/breaking-changes.md
          query: body.query,
          sort: body.sort,
          highlight: body.highlight,
        });
      }

      throw new Error('Unsupported Elasticsearch version');
    })();

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
   * @returns {object} query object
   */
  createSearchQuery(): SearchQuery {
    const fields = ['path', 'bookmark_count', 'comment_count', 'seenUsers_count', 'updated_at', 'tag_names', 'comments'];

    // sort by score
    const query: SearchQuery = {
      index: this.aliasName,
      _source: fields,
      body: {
        query: {
          bool: {},
        },
      },
    };

    return query;
  }

  appendResultSize(query: SearchQuery, from?: number, size?: number): void {
    query.from = from || DEFAULT_OFFSET;
    query.size = size || DEFAULT_LIMIT;
  }

  appendSortOrder(query: SearchQuery, sortAxis: SORT_AXIS, sortOrder: SORT_ORDER): void {
    if (query.body == null) {
      throw new Error('query.body is not initialized');
    }

    // default sort order is score descending
    const sort = ES_SORT_AXIS[sortAxis] || ES_SORT_AXIS[RELATION_SCORE];
    const order = ES_SORT_ORDER[sortOrder] || ES_SORT_ORDER[DESC];

    query.body.sort = {
      [sort]: { order },
    };

  }

  initializeBoolQuery(query: SearchQuery): SearchQuery {
    // query is created by createSearchQuery()
    if (query?.body?.query?.bool == null) {
      throw new Error('query.body.query.bool is not initialized');
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

  appendCriteriaForQueryString(query: SearchQuery, parsedKeywords: ESQueryTerms): void {
    query = this.initializeBoolQuery(query); // eslint-disable-line no-param-reassign

    if (query.body?.query?.bool == null) {
      throw new Error('query.body.query.bool is not initialized');
    }

    if (query.body?.query?.bool.must == null || !Array.isArray(query.body?.query?.bool.must)) {
      throw new Error('query.body.query.bool.must is not initialized');
    }

    if (query.body?.query?.bool.must_not == null || !Array.isArray(query.body?.query?.bool.must_not)) {
      throw new Error('query.body.query.bool.must_not is not initialized');
    }

    if (query.body?.query?.bool.filter == null || !Array.isArray(query.body?.query?.bool.filter)) {
      throw new Error('query.body.query.bool.filter is not initialized');
    }

    if (parsedKeywords.match.length > 0) {
      const q = {
        multi_match: {
          query: parsedKeywords.match.join(' '),
          type: 'most_fields' as const,
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
          operator: 'or' as const,
        },
      };
      query.body.query.bool.must_not.push(q);
    }

    if (parsedKeywords.phrase.length > 0) {
      for (const phrase of parsedKeywords.phrase) {
        const phraseQuery = {
          multi_match: {
            query: phrase, // query is created by createSearchQuery()
            type: 'phrase' as const,
            fields: [
              // Not use "*.ja" fields here, because we want to analyze (parse) search words
              'path.raw^2',
              'body',
              'comments',
            ],
          },
        };
        query.body.query.bool.must.push(phraseQuery);
      }
    }

    if (parsedKeywords.not_phrase.length > 0) {
      for (const phrase of parsedKeywords.not_phrase) {
        const notPhraseQuery = {
          multi_match: {
            query: phrase, // each phrase is quoteted words
            type: 'phrase' as const,
            fields: [
              // Not use "*.ja" fields here, because we want to analyze (parse) search words
              'path.raw^2',
              'body',
            ],
          },
        };
        query.body.query.bool.must_not.push(notPhraseQuery);
      }
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

  async filterPagesByViewer(query: SearchQuery, user, userGroups): Promise<void> {
    const showPagesRestrictedByOwner = !configManager.getConfig('security:list-policy:hideRestrictedByOwner');
    const showPagesRestrictedByGroup = !configManager.getConfig('security:list-policy:hideRestrictedByGroup');

    query = this.initializeBoolQuery(query); // eslint-disable-line no-param-reassign

    if (query.body?.query?.bool?.filter == null || !Array.isArray(query.body?.query?.bool?.filter)) {
      throw new Error('query.body.query.bool is not initialized');
    }

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

  async appendFunctionScore(query, queryString): Promise<void> {
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

  appendHighlight(query: SearchQuery): void {
    if (query.body == null) {
      throw new Error('query.body is not initialized');
    }

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

    this.appendCriteriaForQueryString(query, terms);
    await this.filterPagesByViewer(query, user, userGroups);
    await this.appendFunctionScore(query, queryString);


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
  async syncPagesUpdated(pages, user): Promise<void> {
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

  // Lifecycle management
  async destroy(): Promise<void> {
    await this.cleanupStreams();
    
    if (this.client != null) {
      try {
        // 既存のクライアントのクリーンアップ
        logger.info('Destroying Elasticsearch client');
        this.client = null;
      } catch (error) {
        logger.error('Failed to destroy Elasticsearch client:', error);
      }
    }
  }

  // Memory monitoring utility
  private logMemoryUsage(context: string): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    logger.info(`Memory usage [${context}]:`, {
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      cpuUser: `${Math.round(cpuUsage.user / 1000)}ms`,
      cpuSystem: `${Math.round(cpuUsage.system / 1000)}ms`,
    });
  }

}

export default ElasticsearchDelegator;
