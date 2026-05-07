import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtractionOutcome } from '~/features/search-attachments/interfaces/attachment-search';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';

import type { AttachmentIndexOperations } from './attachment-search-delegator-extension';
import {
  AttachmentSearchIndexer,
  type AttachmentSearchIndexerOptions,
  type ReindexBatchRef,
} from './attachment-search-indexer';
import type { AttachmentTextExtractorService } from './attachment-text-extractor';
import type { ExtractionFailureLogServiceInterface } from './extraction-failure-log-service';

// Mock configManager before any module that reads it is imported
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Mock Attachment model
vi.mock('~/server/models/attachment', () => ({
  Attachment: {
    findById: vi.fn(),
  },
}));

// ---- Helpers ----

function makeAttachment(
  overrides: Partial<IAttachmentDocument> = {},
): IAttachmentDocument {
  return {
    _id: { toString: () => 'att-001' },
    fileName: 'doc.pdf',
    originalName: 'document.pdf',
    fileFormat: 'application/pdf',
    fileSize: 2048,
    attachmentType: 'attachment',
    page: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides,
  } as unknown as IAttachmentDocument;
}

function makeMullerFile(): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'document.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 2048,
    buffer: Buffer.from(''),
    destination: '',
    filename: '',
    path: '',
    stream: null as unknown as import('node:stream').Readable,
  };
}

// ---- Mock factories ----

function makeExtractor(
  outcome: ExtractionOutcome = {
    kind: 'success',
    pages: [{ pageNumber: 1, label: 'Page 1', content: 'Hello' }],
    mimeType: 'application/pdf',
  },
): AttachmentTextExtractorService {
  return {
    extractAttachment: vi.fn().mockResolvedValue(outcome),
  } as unknown as AttachmentTextExtractorService;
}

function makeDelegator(): AttachmentIndexOperations {
  return {
    syncAttachmentIndexed: vi.fn().mockResolvedValue(undefined),
    syncAttachmentRemoved: vi.fn().mockResolvedValue(undefined),
    createAttachmentIndex: vi.fn(),
    addAllAttachments: vi.fn(),
    initializeAttachmentIndex: vi.fn(),
    searchAttachmentsBody: vi.fn(),
    searchAttachmentsByPageIdsBody: vi.fn(),
    mgetPagesForPermissionBody: vi.fn(),
  } as unknown as AttachmentIndexOperations;
}

function makeFailureLog(): ExtractionFailureLogServiceInterface {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    listRecent: vi.fn(),
    totalRecent: vi.fn(),
  } as unknown as ExtractionFailureLogServiceInterface;
}

function makeReindexBatch(
  isRebuilding = false,
  tmpIndexName: string | null = null,
): ReindexBatchRef {
  return {
    isRebuilding: vi.fn().mockReturnValue(isRebuilding),
    getTmpIndexName: vi.fn().mockReturnValue(tmpIndexName),
  };
}

function makeSearchService(isConfigured = true): { isConfigured: boolean } {
  return { isConfigured };
}

/** Convenience factory that creates an AttachmentSearchIndexer from positional args. */
// biome-ignore lint/complexity/useMaxParams: test helper intentionally mirrors the 5 deps
function makeIndexer(
  extractor: AttachmentTextExtractorService,
  delegatorExt: AttachmentIndexOperations,
  failureLog: ExtractionFailureLogServiceInterface,
  reindexBatch: ReindexBatchRef,
  searchService: { isConfigured: boolean },
): AttachmentSearchIndexer {
  const opts: AttachmentSearchIndexerOptions = {
    extractor,
    delegatorExt,
    failureLog,
    reindexBatch,
    searchService,
  };
  return new AttachmentSearchIndexer(opts);
}

/** Sets up configManager mock to return values that make isFeatureEnabled() return true */
function enableFeature(): void {
  vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
    if (key === 'app:attachmentFullTextSearch:extractorUri')
      return 'http://extractor:8080';
    if (key === 'app:attachmentFullTextSearch:extractorToken')
      return 'secret-token';
    return undefined;
  });
}

/** Sets up configManager mock so that isFeatureEnabled() returns false */
function disableFeature(): void {
  vi.mocked(configManager.getConfig).mockReturnValue(undefined);
}

// ---- Tests ----

describe('AttachmentSearchIndexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // 1. onAttach: feature disabled → no extractor call
  // ----------------------------------------------------------------

  describe('onAttach — feature disabled', () => {
    it('returns early without calling the extractor when feature is disabled', async () => {
      disableFeature();

      const extractor = makeExtractor();
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();
      const searchService = makeSearchService(false);

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        searchService,
      );

      const attachment = makeAttachment();
      const file = makeMullerFile();

      await indexer.onAttach(null, attachment, file);

      expect(extractor.extractAttachment).not.toHaveBeenCalled();
      expect(delegator.syncAttachmentIndexed).not.toHaveBeenCalled();
    });

    it('returns early when extractorUri is missing even if searchService is configured', async () => {
      vi.mocked(configManager.getConfig).mockImplementation((key: string) => {
        if (key === 'app:attachmentFullTextSearch:extractorToken')
          return 'secret-token';
        return undefined; // no extractorUri
      });

      const extractor = makeExtractor();
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();
      const searchService = makeSearchService(true);

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        searchService,
      );

      await indexer.onAttach('page-1', makeAttachment(), makeMullerFile());

      expect(extractor.extractAttachment).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 2. onAttach: success outcome → correct docs, no permission fields
  // ----------------------------------------------------------------

  describe('onAttach — success outcome', () => {
    it('calls syncAttachmentIndexed with correct docs, no permission fields', async () => {
      enableFeature();

      const successOutcome: ExtractionOutcome = {
        kind: 'success',
        pages: [
          { pageNumber: 1, label: 'Cover', content: 'Hello world' },
          { pageNumber: 2, label: null, content: 'Second page' },
        ],
        mimeType: 'application/pdf',
      };

      const extractor = makeExtractor(successOutcome);
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();
      const searchService = makeSearchService(true);

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        searchService,
      );

      const attachment = makeAttachment();

      await indexer.onAttach('page-42', attachment, makeMullerFile());

      expect(extractor.extractAttachment).toHaveBeenCalledWith('att-001');
      expect(delegator.syncAttachmentIndexed).toHaveBeenCalledOnce();

      const [calledAttachmentId, calledPageId, calledDocs, calledIndexes] =
        vi.mocked(delegator.syncAttachmentIndexed).mock.calls[0];

      expect(calledAttachmentId).toBe('att-001');
      expect(calledPageId).toBe('page-42');
      expect(calledIndexes).toEqual(['attachments']);

      // Two docs — one per extracted page
      expect(calledDocs).toHaveLength(2);

      // Verify NO permission fields in either doc
      for (const doc of calledDocs) {
        expect(doc).not.toHaveProperty('grant');
        expect(doc).not.toHaveProperty('grantedUsers');
        expect(doc).not.toHaveProperty('grantedGroups');
        expect(doc).not.toHaveProperty('granted_users');
        expect(doc).not.toHaveProperty('granted_groups');
        expect(doc).not.toHaveProperty('creator');
      }

      // Verify shape of first doc
      expect(calledDocs[0]).toMatchObject({
        attachmentId: 'att-001',
        pageId: 'page-42',
        pageNumber: 1,
        label: 'Cover',
        content: 'Hello world',
        fileName: 'doc.pdf',
        originalName: 'document.pdf',
        fileFormat: 'application/pdf',
        fileSize: 2048,
        attachmentType: 'attachment',
      });

      // Failure log must NOT be called on success
      expect(failureLog.record).not.toHaveBeenCalled();
    });

    it('uses empty string for pageId when pageId argument is null', async () => {
      enableFeature();

      const extractor = makeExtractor({
        kind: 'success',
        pages: [{ pageNumber: 1, label: null, content: 'Content' }],
        mimeType: 'application/pdf',
      });
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      await indexer.onAttach(null, makeAttachment(), makeMullerFile());

      const [, calledPageId] = vi.mocked(delegator.syncAttachmentIndexed).mock
        .calls[0];
      expect(calledPageId).toBe('');

      const [calledDocs] = [
        vi.mocked(delegator.syncAttachmentIndexed).mock.calls[0][2],
      ];
      expect(calledDocs[0].pageId).toBe('');
    });
  });

  // ----------------------------------------------------------------
  // 3. onAttach: failure outcome → metadata-only doc + failureLog.record
  // ----------------------------------------------------------------

  describe('onAttach — failure outcomes', () => {
    it.each([
      [
        'unsupported',
        { kind: 'unsupported', mimeType: 'image/bmp' } as ExtractionOutcome,
        'unsupportedFormat',
      ],
      [
        'tooLarge',
        { kind: 'tooLarge', fileSize: 999999 } as ExtractionOutcome,
        'fileTooLarge',
      ],
      [
        'timeout',
        { kind: 'timeout' } as ExtractionOutcome,
        'extractionTimeout',
      ],
      [
        'serviceBusy',
        { kind: 'serviceBusy' } as ExtractionOutcome,
        'serviceBusy',
      ],
      [
        'serviceUnreachable',
        { kind: 'serviceUnreachable' } as ExtractionOutcome,
        'serviceUnreachable',
      ],
      [
        'failed',
        {
          kind: 'failed',
          reasonCode: 'extraction_failed',
          message: 'oops',
        } as ExtractionOutcome,
        'extractionFailed',
      ],
    ])('%s outcome: indexes metadata-only doc and records failure', async (_, outcome, expectedReasonCode) => {
      enableFeature();

      const extractor = makeExtractor(outcome);
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      const attachment = makeAttachment();
      await indexer.onAttach('page-1', attachment, makeMullerFile());

      // Exactly one doc indexed (metadata-only)
      expect(delegator.syncAttachmentIndexed).toHaveBeenCalledOnce();
      const [, , docs] = vi.mocked(delegator.syncAttachmentIndexed).mock
        .calls[0];
      expect(docs).toHaveLength(1);
      expect(docs[0].content).toBe('');
      expect(docs[0].pageNumber).toBeNull();
      expect(docs[0].label).toBeNull();

      // NO permission fields in failure doc either
      expect(docs[0]).not.toHaveProperty('grant');
      expect(docs[0]).not.toHaveProperty('creator');

      // Failure log called with correct reasonCode
      expect(failureLog.record).toHaveBeenCalledOnce();
      const [entry] = vi.mocked(failureLog.record).mock.calls[0];
      expect(entry.reasonCode).toBe(expectedReasonCode);
      expect(entry.attachmentId).toBe('att-001');
    });
  });

  // ----------------------------------------------------------------
  // 4. onAttach: dual-write when isRebuilding=true
  // ----------------------------------------------------------------

  describe('onAttach — dual-write (isRebuilding=true)', () => {
    it('writes to both live and tmp indexes when rebuilding', async () => {
      enableFeature();

      const extractor = makeExtractor({
        kind: 'success',
        pages: [{ pageNumber: 1, label: null, content: 'content' }],
        mimeType: 'application/pdf',
      });
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch(true, 'attachments-tmp');

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      await indexer.onAttach('page-1', makeAttachment(), makeMullerFile());

      // Should be called twice: once for live, once for tmp
      expect(delegator.syncAttachmentIndexed).toHaveBeenCalledTimes(2);

      const allCalls = vi.mocked(delegator.syncAttachmentIndexed).mock.calls;
      const liveCall = allCalls.find(
        (c) => c[3].includes('attachments') && c[3].length === 1,
      );
      const tmpCall = allCalls.find((c) => c[3].includes('attachments-tmp'));

      expect(liveCall).toBeDefined();
      expect(tmpCall).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // 5. onAttach: tmp-side write failure doesn't throw (live succeeds)
  // ----------------------------------------------------------------

  describe('onAttach — tmp-side write failure is non-blocking', () => {
    it('does not throw when tmp-side syncAttachmentIndexed fails', async () => {
      enableFeature();

      const extractor = makeExtractor({
        kind: 'success',
        pages: [{ pageNumber: 1, label: null, content: 'content' }],
        mimeType: 'application/pdf',
      });

      // First call (live) succeeds, second call (tmp) throws
      const delegator = makeDelegator();
      let callCount = 0;
      vi.mocked(delegator.syncAttachmentIndexed).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('ES tmp-side error'));
        }
        return Promise.resolve();
      });

      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch(true, 'attachments-tmp');

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      // Must not throw
      await expect(
        indexer.onAttach('page-1', makeAttachment(), makeMullerFile()),
      ).resolves.toBeUndefined();

      // Live write still happened
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ----------------------------------------------------------------
  // 6. onDetach: calls syncAttachmentRemoved with correct indexes
  // ----------------------------------------------------------------

  describe('onDetach', () => {
    it('calls syncAttachmentRemoved with live index only when not rebuilding', async () => {
      const delegator = makeDelegator();
      const reindexBatch = makeReindexBatch(false, null);

      const indexer = makeIndexer(
        makeExtractor(),
        delegator,
        makeFailureLog(),
        reindexBatch,
        makeSearchService(true),
      );

      await indexer.onDetach('att-001');

      expect(delegator.syncAttachmentRemoved).toHaveBeenCalledWith('att-001', [
        'attachments',
      ]);
    });

    it('calls syncAttachmentRemoved for both live and tmp when rebuilding', async () => {
      const delegator = makeDelegator();
      const reindexBatch = makeReindexBatch(true, 'attachments-tmp');

      const indexer = makeIndexer(
        makeExtractor(),
        delegator,
        makeFailureLog(),
        reindexBatch,
        makeSearchService(true),
      );

      await indexer.onDetach('att-999');

      const calls = vi.mocked(delegator.syncAttachmentRemoved).mock.calls;
      const liveCall = calls.find(
        (c) => c[1].includes('attachments') && c[1].length === 1,
      );
      const tmpCall = calls.find((c) => c[1].includes('attachments-tmp'));

      expect(liveCall).toBeDefined();
      expect(tmpCall).toBeDefined();
      if (liveCall == null || tmpCall == null) return;
      expect(liveCall[0]).toBe('att-999');
      expect(tmpCall[0]).toBe('att-999');
    });

    it('does not throw if syncAttachmentRemoved throws', async () => {
      const delegator = makeDelegator();
      vi.mocked(delegator.syncAttachmentRemoved).mockRejectedValue(
        new Error('ES error'),
      );
      const reindexBatch = makeReindexBatch(false, null);

      const indexer = makeIndexer(
        makeExtractor(),
        delegator,
        makeFailureLog(),
        reindexBatch,
        makeSearchService(true),
      );

      await expect(indexer.onDetach('att-001')).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 7. reindex: attachment not found → { ok: false }
  // ----------------------------------------------------------------

  describe('reindex — attachment not found', () => {
    it('returns { ok: false } when Attachment.findById returns null', async () => {
      enableFeature();
      vi.mocked(Attachment.findById).mockResolvedValue(null);

      const extractor = makeExtractor();
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      const result = await indexer.reindex('nonexistent-id');

      expect(result.ok).toBe(false);
      expect(extractor.extractAttachment).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 8. reindex: success → { ok: true, outcome }
  // ----------------------------------------------------------------

  describe('reindex — success', () => {
    it('returns { ok: true, outcome } on successful extraction', async () => {
      enableFeature();

      const attachment = makeAttachment({
        page: {
          toString: () => 'page-77',
        } as unknown as IAttachmentDocument['page'],
      });
      vi.mocked(Attachment.findById).mockResolvedValue(attachment);

      const successOutcome: ExtractionOutcome = {
        kind: 'success',
        pages: [{ pageNumber: 1, label: null, content: 'content' }],
        mimeType: 'application/pdf',
      };
      const extractor = makeExtractor(successOutcome);
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      const result = await indexer.reindex('att-001');

      expect(result.ok).toBe(true);
      expect(result.outcome.kind).toBe('success');

      expect(extractor.extractAttachment).toHaveBeenCalledWith('att-001');
      expect(delegator.syncAttachmentIndexed).toHaveBeenCalledOnce();

      // Verify no permission fields
      const [, , docs] = vi.mocked(delegator.syncAttachmentIndexed).mock
        .calls[0];
      for (const doc of docs) {
        expect(doc).not.toHaveProperty('grant');
        expect(doc).not.toHaveProperty('creator');
        expect(doc).not.toHaveProperty('grantedUsers');
        expect(doc).not.toHaveProperty('grantedGroups');
      }
    });

    it('returns { ok: true, outcome } with failure kind on extraction failure', async () => {
      enableFeature();

      const attachment = makeAttachment();
      vi.mocked(Attachment.findById).mockResolvedValue(attachment);

      const failureOutcome: ExtractionOutcome = { kind: 'timeout' };
      const extractor = makeExtractor(failureOutcome);
      const delegator = makeDelegator();
      const failureLog = makeFailureLog();
      const reindexBatch = makeReindexBatch();

      const indexer = makeIndexer(
        extractor,
        delegator,
        failureLog,
        reindexBatch,
        makeSearchService(true),
      );

      const result = await indexer.reindex('att-001');

      expect(result.ok).toBe(true);
      expect(result.outcome.kind).toBe('timeout');
      expect(failureLog.record).toHaveBeenCalledOnce();
    });

    it('returns { ok: false } when feature is disabled', async () => {
      disableFeature();

      const extractor = makeExtractor();
      const delegator = makeDelegator();

      const indexer = makeIndexer(
        extractor,
        delegator,
        makeFailureLog(),
        makeReindexBatch(),
        makeSearchService(false),
      );

      const result = await indexer.reindex('att-001');

      expect(result.ok).toBe(false);
      expect(extractor.extractAttachment).not.toHaveBeenCalled();
    });
  });
});
