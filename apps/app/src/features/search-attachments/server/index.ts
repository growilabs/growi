import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { createAttachmentOrphanSweeper } from './services/attachment-orphan-sweeper';
import { AttachmentReindexBatch } from './services/attachment-reindex-batch';
import { AttachmentSearchDelegatorExtension } from './services/attachment-search-delegator-extension';
import { AttachmentSearchIndexer } from './services/attachment-search-indexer';
import {
  AttachmentSearchResultAggregator,
  createAttachmentIndexClient,
} from './services/attachment-search-result-aggregator';
import { AttachmentTextExtractorService } from './services/attachment-text-extractor';
import { ExtractionFailureLogService } from './services/extraction-failure-log-service';

const logger = loggerFactory('growi:features:search-attachments:init');

/**
 * Wire attachment full-text search into Crowi.
 *
 * Must be called AFTER searchService and attachmentService are initialized.
 *
 * When the feature is disabled (extractorUri or extractorToken unset, or
 * searchService not configured), this function returns immediately without
 * registering any handlers — full backward compatibility is preserved.
 */
export function initAttachmentFullTextSearch(crowi: Crowi): void {
  const {
    searchService,
    attachmentService,
    socketIoService,
    fileUploadService,
  } = crowi;

  // ----------------------------------------------------------------
  // Feature gate — check all required config values
  // ----------------------------------------------------------------
  const extractorUri = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorUri',
  ) as string | null | undefined;
  const extractorToken = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorToken',
  ) as string | null | undefined;

  const isEnabled =
    searchService?.isConfigured === true &&
    extractorUri != null &&
    extractorUri !== '' &&
    extractorToken != null &&
    extractorToken !== '';

  if (!isEnabled) {
    logger.info(
      'Attachment full-text search disabled ' +
        `(searchConfigured=${searchService?.isConfigured}, ` +
        `extractorUri=${extractorUri != null ? '"set"' : 'null'}, ` +
        `extractorToken=${extractorToken != null ? '"set"' : 'null'})`,
    );
    return;
  }

  // ----------------------------------------------------------------
  // Build shared services
  // ----------------------------------------------------------------
  const failureLogService = new ExtractionFailureLogService();
  const extractor = new AttachmentTextExtractorService(fileUploadService);

  // Access the raw ES client via the delegator (typed `any` at declaration site)
  // biome-ignore lint/suspicious/noExplicitAny: delegator.client is private; runtime access is intentional
  const esClient: any = (searchService.fullTextSearchDelegator as any)?.client;

  const delegatorExt = new AttachmentSearchDelegatorExtension(esClient);

  // ----------------------------------------------------------------
  // Build orphan sweeper with version-agnostic ES callbacks
  // ----------------------------------------------------------------
  const runSearch = async (
    indexName: string,
    body: unknown,
  ): Promise<unknown> => {
    return esClient.search({ index: indexName, body });
  };

  const runDeleteByPageId = async (
    targetIndex: string,
    pageId: string,
  ): Promise<void> => {
    await esClient.deleteByQuery({
      index: targetIndex,
      body: { query: { term: { pageId } } },
      conflicts: 'proceed',
    });
  };

  const orphanSweeper = createAttachmentOrphanSweeper(
    delegatorExt,
    runSearch,
    runDeleteByPageId,
  );

  // ----------------------------------------------------------------
  // Build batch and indexer
  // ----------------------------------------------------------------
  const reindexBatch = new AttachmentReindexBatch(
    extractor,
    delegatorExt,
    failureLogService,
    orphanSweeper,
    socketIoService,
  );

  const indexer = new AttachmentSearchIndexer({
    extractor,
    delegatorExt,
    failureLog: failureLogService,
    reindexBatch,
    searchService,
  });

  // ----------------------------------------------------------------
  // Register attach/detach handlers
  // ----------------------------------------------------------------
  attachmentService.addAttachHandler(indexer.onAttach.bind(indexer));
  attachmentService.addDetachHandler(indexer.onDetach.bind(indexer));

  // ----------------------------------------------------------------
  // Store on crowi for route access
  // ----------------------------------------------------------------
  // biome-ignore lint/suspicious/noExplicitAny: Crowi is typed via declaration merging in task 9.1
  (crowi as any).attachmentSearchIndexer = indexer;
  // biome-ignore lint/suspicious/noExplicitAny: Crowi is typed via declaration merging in task 9.1
  (crowi as any).attachmentReindexBatch = reindexBatch;

  // ----------------------------------------------------------------
  // Build and inject AttachmentSearchResultAggregator into SearchService
  // ----------------------------------------------------------------
  const pageIndexAlias = `${searchService.fullTextSearchDelegator?.aliasName ?? 'crowi-alias'}`;

  // Build a version-agnostic rawSearch wrapping the ES client
  const rawSearch = async (
    index: string,
    body: Record<string, unknown>,
  ): Promise<unknown> => {
    const result = await esClient.search({ index, body });
    // ES7 returns result.body; ES8/ES9 return result directly
    return result?.hits != null ? result : (result?.body ?? result);
  };

  // Build a version-agnostic rawMget wrapping the ES client
  const rawMget = async (
    index: string,
    body: Record<string, unknown>,
  ): Promise<unknown> => {
    const result = await esClient.mget({ index, body });
    // ES7 returns result.body; ES8/ES9 return result directly
    return result?.docs != null ? result : (result?.body ?? result);
  };

  const attachmentClient = createAttachmentIndexClient(
    'attachments',
    pageIndexAlias,
    // biome-ignore lint/suspicious/noExplicitAny: RawEsSearchFn/RawEsMgetFn accept any-typed returns
    rawSearch as any,
    // biome-ignore lint/suspicious/noExplicitAny: RawEsSearchFn/RawEsMgetFn accept any-typed returns
    rawMget as any,
  );

  /**
   * PageSearchFn — delegates to the existing ES search pipeline without
   * touching the attachment index.  Reads the query through parseSearchQuery
   * + resolve so Named-Query aliasing is applied normally.
   */
  const pageSearchFn = async (
    keyword: string,
    options: { from: number; size: number },
  ) => {
    const parsedQuery = await searchService.parseSearchQuery(keyword, null);
    const [delegator, data] = await searchService.resolve(parsedQuery);
    return delegator.search(
      data,
      undefined,
      undefined,
      options,
    ) as Promise<any>;
  };

  const aggregator = new AttachmentSearchResultAggregator(
    pageSearchFn,
    attachmentClient,
  );

  searchService.setAttachmentSearchResultAggregator(aggregator);

  logger.info('Attachment full-text search initialized');
}
