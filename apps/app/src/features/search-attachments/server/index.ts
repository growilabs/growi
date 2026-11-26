import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { createAttachmentOrphanSweeper } from './services/attachment-orphan-sweeper';
import { AttachmentReindexBatch } from './services/attachment-reindex-batch';
import {
  AttachmentSearchDelegatorExtension,
  attachmentIndexNames,
} from './services/attachment-search-delegator-extension';
import { AttachmentSearchIndexer } from './services/attachment-search-indexer';
import { AttachmentTextExtractorService } from './services/attachment-text-extractor';
import { createAttachmentSearchResultAggregator } from './services/create-attachment-search-result-aggregator';
import { ExtractionFailureLogService } from './services/extraction-failure-log-service';
import { isAttachmentFullTextSearchEnabled } from './services/is-attachment-full-text-search-enabled';

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

  const delegatorExt = new AttachmentSearchDelegatorExtension(
    esClient,
    attachmentIndexNames(
      searchService.fullTextSearchDelegator.getConnectionInfo().indexName,
    ),
  );

  // Enabling the feature later creates it from the admin config route
  if (isAttachmentFullTextSearchEnabled(true)) {
    try {
      await delegatorExt.ensureAttachmentIndex();
    } catch (err) {
      logger.error({ err }, 'Failed to create the attachment index');
    }
  }

  const orphanSweeper = createAttachmentOrphanSweeper(delegatorExt);

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
  crowi.attachmentIndexOperations = delegatorExt;

  // ----------------------------------------------------------------
  // Build and inject AttachmentSearchResultAggregator into SearchService
  // ----------------------------------------------------------------
  const aggregator = createAttachmentSearchResultAggregator({
    searchService,
    esClient,
    attachmentIndexName: delegatorExt.aliasName,
  });

  searchService.setAttachmentSearchResultAggregator(aggregator);

  logger.info('Attachment full-text search initialized');
}
