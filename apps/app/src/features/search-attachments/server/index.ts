import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { createAttachmentOrphanSweeper } from './services/attachment-orphan-sweeper';
import { AttachmentReindexBatch } from './services/attachment-reindex-batch';
import {
  ATTACHMENT_INDEX_NAMES,
  AttachmentSearchDelegatorExtension,
} from './services/attachment-search-delegator-extension';
import { AttachmentSearchIndexer } from './services/attachment-search-indexer';
import { AttachmentTextExtractorService } from './services/attachment-text-extractor';
import { createAttachmentSearchResultAggregator } from './services/create-attachment-search-result-aggregator';
import { ExtractionFailureLogService } from './services/extraction-failure-log-service';

const logger = loggerFactory('growi:features:search-attachments:init');

/**
 * Wire attachment full-text search into Crowi.
 *
 * Must be called AFTER searchService and attachmentService are initialized.
 *
 * Everything is registered whenever Elasticsearch is configured, even while
 * the extractor settings are unset: each part checks
 * isAttachmentFullTextSearchEnabled when it is called, so enabling the
 * feature from the admin page takes effect without a restart.
 */
export async function initAttachmentFullTextSearch(
  crowi: Crowi,
): Promise<void> {
  const {
    searchService,
    attachmentService,
    socketIoService,
    fileUploadService,
  } = crowi;

  // Unlike the extractor settings, this is fixed for the process lifetime.
  if (searchService?.isConfigured !== true) {
    logger.info(
      'Attachment full-text search not wired: search service is not configured',
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

  // Created even while the feature is disabled, so enabling it later needs
  // no restart; mirrors the page index normalization at startup.
  try {
    await delegatorExt.ensureAttachmentIndex();
  } catch (err) {
    logger.error({ err }, 'Failed to create the attachment index');
  }

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
  crowi.attachmentSearchIndexer = indexer;
  crowi.attachmentReindexBatch = reindexBatch;

  // ----------------------------------------------------------------
  // Build and inject AttachmentSearchResultAggregator into SearchService
  // ----------------------------------------------------------------
  const aggregator = createAttachmentSearchResultAggregator({
    searchService,
    esClient,
    attachmentIndexName: ATTACHMENT_INDEX_NAMES.alias,
  });

  searchService.setAttachmentSearchResultAggregator(aggregator);

  logger.info('Attachment full-text search initialized');
}
