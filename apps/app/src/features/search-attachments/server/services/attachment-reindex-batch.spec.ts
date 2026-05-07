/**
 * Tests for AttachmentReindexBatch (task 6.3).
 *
 * All external dependencies (extractor, delegatorExt, failureLogService,
 * orphanSweeper, socketIoService, and the Attachment Mongoose model) are fully
 * stubbed — no live services are required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SocketEventName } from '~/interfaces/websocket';

import {
  AttachmentReindexBatch,
  type AttachmentReindexBatchInterface,
  type ProgressCallback,
} from './attachment-reindex-batch';

// ---------------------------------------------------------------------------
// Mock the Attachment model (used for countDocuments + cursor)
// ---------------------------------------------------------------------------

vi.mock('~/server/models/attachment', () => ({
  Attachment: {
    countDocuments: vi.fn(),
    find: vi.fn(),
  },
}));

// Mock logger to silence output
vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal IAttachment-compatible lean document. */
function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => 'attach-001' },
    page: 'page-abc',
    fileName: 'document.pdf',
    fileFormat: 'application/pdf',
    fileSize: 204800,
    originalName: 'My Document.pdf',
    attachmentType: 'attachment',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

/** Builds a minimal stub for AttachmentIndexOperations. */
function makeDelegatorExtStub() {
  return {
    createAttachmentIndex: vi.fn().mockResolvedValue(undefined),
    syncAttachmentIndexed: vi.fn().mockResolvedValue(undefined),
    syncAttachmentRemoved: vi.fn().mockResolvedValue(undefined),
    searchAttachmentsBody: vi.fn(),
    searchAttachmentsByPageIdsBody: vi.fn(),
    mgetPagesForPermissionBody: vi.fn(),
    addAllAttachments: vi.fn().mockResolvedValue(undefined),
    initializeAttachmentIndex: vi.fn().mockResolvedValue({ initialized: true }),
  };
}

/** Builds a minimal stub for AttachmentTextExtractorService. */
function makeExtractorStub() {
  return {
    extractAttachment: vi.fn(),
  };
}

/** Builds a minimal stub for ExtractionFailureLogServiceInterface. */
function makeFailureLogStub() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    listRecent: vi.fn().mockResolvedValue([]),
    totalRecent: vi.fn().mockResolvedValue(0),
  };
}

/** Builds a minimal stub for AttachmentOrphanSweeper. */
function makeOrphanSweeperStub() {
  return {
    sweep: vi.fn().mockResolvedValue({ removed: 0, failed: 0 }),
  };
}

/** Builds a minimal stub for SocketIoService (admin namespace only). */
function makeSocketIoServiceStub() {
  const emit = vi.fn();
  return {
    getAdminSocket: vi.fn().mockReturnValue({ emit }),
    _emit: emit, // expose for assertions
  };
}

/**
 * Configures the Attachment model mock to expose `total` documents as a
 * cursor, each created from `makeAttachment()` with a unique _id.
 */
async function setupAttachmentMock(
  attachments: ReturnType<typeof makeAttachment>[],
) {
  const { Attachment } = await import('~/server/models/attachment');
  const mockedAttachment = Attachment as unknown as {
    countDocuments: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  mockedAttachment.countDocuments.mockResolvedValue(attachments.length);

  // Create an async iterable cursor from the provided attachments array
  mockedAttachment.find.mockReturnValue({
    lean: vi.fn().mockReturnValue({
      cursor: vi.fn().mockReturnValue(
        // A sync generator is a valid async iterable (for-await-of works on it)
        (function* () {
          for (const a of attachments) {
            yield a;
          }
        })(),
      ),
    }),
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AttachmentReindexBatch', () => {
  let extractor: ReturnType<typeof makeExtractorStub>;
  let delegatorExt: ReturnType<typeof makeDelegatorExtStub>;
  let failureLogService: ReturnType<typeof makeFailureLogStub>;
  let orphanSweeper: ReturnType<typeof makeOrphanSweeperStub>;
  let socketIoService: ReturnType<typeof makeSocketIoServiceStub>;
  let batch: AttachmentReindexBatchInterface;

  beforeEach(() => {
    vi.clearAllMocks();

    extractor = makeExtractorStub();
    delegatorExt = makeDelegatorExtStub();
    failureLogService = makeFailureLogStub();
    orphanSweeper = makeOrphanSweeperStub();
    socketIoService = makeSocketIoServiceStub();

    batch = new AttachmentReindexBatch(
      // biome-ignore lint/suspicious/noExplicitAny: test stubs
      extractor as any,
      // biome-ignore lint/suspicious/noExplicitAny: test stubs
      delegatorExt as any,
      // biome-ignore lint/suspicious/noExplicitAny: test stubs
      failureLogService as any,
      // biome-ignore lint/suspicious/noExplicitAny: test stubs
      orphanSweeper as any,
      // biome-ignore lint/suspicious/noExplicitAny: test stubs
      socketIoService as any,
    );
  });

  // -------------------------------------------------------------------------
  // 1. begin() sets isRebuilding + getTmpIndexName
  // -------------------------------------------------------------------------
  describe('begin()', () => {
    it('sets isRebuilding=true and records the tmp index name', () => {
      batch.begin('attachments-tmp');

      expect(batch.isRebuilding()).toBe(true);
      expect(batch.getTmpIndexName()).toBe('attachments-tmp');
    });

    it('throws a 409-status error when a rebuild is already in progress', () => {
      batch.begin('attachments-tmp');

      let caught: unknown;
      try {
        batch.begin('attachments-tmp');
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error & { status: number }).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  // 2. end() clears state
  // -------------------------------------------------------------------------
  describe('end()', () => {
    it('sets isRebuilding=false and clears getTmpIndexName', () => {
      batch.begin('attachments-tmp');
      batch.end();

      expect(batch.isRebuilding()).toBe(false);
      expect(batch.getTmpIndexName()).toBeNull();
    });

    it('is safe to call even when begin() was never called', () => {
      // Should not throw
      expect(() => batch.end()).not.toThrow();
      expect(batch.isRebuilding()).toBe(false);
      expect(batch.getTmpIndexName()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. addAllAttachments — success path
  // -------------------------------------------------------------------------
  describe('addAllAttachments — success path', () => {
    it('iterates all attachments, calls extractor, and indexes success docs', async () => {
      const attachment1 = makeAttachment({
        _id: { toString: () => 'attach-001' },
      });
      const attachment2 = makeAttachment({
        _id: { toString: () => 'attach-002' },
      });

      await setupAttachmentMock([attachment1, attachment2]);

      const successOutcome = {
        kind: 'success' as const,
        pages: [{ pageNumber: 1, label: 'Page 1', content: 'Hello world' }],
        mimeType: 'application/pdf',
      };

      extractor.extractAttachment
        .mockResolvedValueOnce(successOutcome)
        .mockResolvedValueOnce(successOutcome);

      const progressCalls: Array<[number, number]> = [];
      const progress: ProgressCallback = (p, t) => progressCalls.push([p, t]);

      await batch.addAllAttachments('attachments-tmp', progress);

      // Both attachments were extracted
      expect(extractor.extractAttachment).toHaveBeenCalledTimes(2);
      expect(extractor.extractAttachment).toHaveBeenCalledWith('attach-001');
      expect(extractor.extractAttachment).toHaveBeenCalledWith('attach-002');

      // Docs were upserted for each attachment
      expect(delegatorExt.syncAttachmentIndexed).toHaveBeenCalledTimes(2);

      // No failures recorded
      expect(failureLogService.record).not.toHaveBeenCalled();

      // Progress callback called once per attachment
      expect(progressCalls).toEqual([
        [1, 2],
        [2, 2],
      ]);
    });

    it('drops and recreates the target index before walking the cursor', async () => {
      await setupAttachmentMock([]);

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      expect(delegatorExt.createAttachmentIndex).toHaveBeenCalledOnce();
      expect(delegatorExt.createAttachmentIndex).toHaveBeenCalledWith(
        'attachments-tmp',
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. addAllAttachments — failure path (batch continues)
  // -------------------------------------------------------------------------
  describe('addAllAttachments — failure path', () => {
    it('records metadata-only doc + failureLog when extraction fails, and continues batch', async () => {
      const attachment = makeAttachment();
      await setupAttachmentMock([attachment]);

      const failureOutcome = {
        kind: 'failed' as const,
        reasonCode: 'parse_error',
        message: 'PDF parser crashed',
      };

      extractor.extractAttachment.mockResolvedValueOnce(failureOutcome);

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      // Metadata-only doc still indexed
      expect(delegatorExt.syncAttachmentIndexed).toHaveBeenCalledOnce();
      const [attachmentId, pageId, docs] =
        delegatorExt.syncAttachmentIndexed.mock.calls[0];
      expect(attachmentId).toBe('attach-001');
      expect(pageId).toBe('page-abc');
      expect(docs).toHaveLength(1);
      expect(docs[0].content).toBe('');
      expect(docs[0].pageNumber).toBeNull();

      // Failure recorded
      expect(failureLogService.record).toHaveBeenCalledOnce();
      const recordArg = failureLogService.record.mock.calls[0][0];
      expect(recordArg.attachmentId).toBe('attach-001');
      expect(recordArg.reasonCode).toBe('extractionFailed');
      expect(recordArg.message).toBe('PDF parser crashed');
    });

    it('maps all failure kinds to the correct reasonCode', async () => {
      const failureKinds = [
        {
          outcome: { kind: 'unsupported', mimeType: 'video/mp4' } as const,
          expectedCode: 'unsupportedFormat',
        },
        {
          outcome: { kind: 'tooLarge', fileSize: 1e9 } as const,
          expectedCode: 'fileTooLarge',
        },
        {
          outcome: { kind: 'timeout' } as const,
          expectedCode: 'extractionTimeout',
        },
        {
          outcome: { kind: 'serviceBusy' } as const,
          expectedCode: 'serviceBusy',
        },
        {
          outcome: { kind: 'serviceUnreachable' } as const,
          expectedCode: 'serviceUnreachable',
        },
        {
          outcome: {
            kind: 'failed',
            reasonCode: 'x',
            message: 'msg',
          } as const,
          expectedCode: 'extractionFailed',
        },
      ];

      for (const { outcome, expectedCode } of failureKinds) {
        vi.clearAllMocks();

        const attachment = makeAttachment({
          _id: { toString: () => 'attach-kind-test' },
        });
        // biome-ignore lint/performance/noAwaitInLoops: sequential iteration is intentional in this test
        await setupAttachmentMock([attachment]);

        extractor.extractAttachment.mockResolvedValueOnce(outcome);

        // biome-ignore lint/performance/noAwaitInLoops: sequential iteration is intentional in this test
        await batch.addAllAttachments('attachments-tmp', vi.fn());

        expect(failureLogService.record).toHaveBeenCalledOnce();
        expect(failureLogService.record.mock.calls[0][0].reasonCode).toBe(
          expectedCode,
        );
      }
    });

    it('skips the attachment and continues when an unexpected error is thrown', async () => {
      const attachment1 = makeAttachment({
        _id: { toString: () => 'attach-err' },
      });
      const attachment2 = makeAttachment({
        _id: { toString: () => 'attach-ok' },
      });
      await setupAttachmentMock([attachment1, attachment2]);

      // First attachment throws unexpectedly
      extractor.extractAttachment
        .mockRejectedValueOnce(new Error('Unexpected boom'))
        .mockResolvedValueOnce({
          kind: 'success' as const,
          pages: [{ pageNumber: 1, label: null, content: 'ok' }],
          mimeType: 'text/plain',
        });

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      // Second attachment was still processed
      expect(extractor.extractAttachment).toHaveBeenCalledTimes(2);
      // Only one successful sync (first attachment was skipped)
      expect(delegatorExt.syncAttachmentIndexed).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // 5. addAllAttachments — orphan sweep
  // -------------------------------------------------------------------------
  describe('addAllAttachments — orphan sweep', () => {
    it('runs orphan sweep on targetIndex after all docs are indexed', async () => {
      await setupAttachmentMock([]);

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      expect(orphanSweeper.sweep).toHaveBeenCalledOnce();
      expect(orphanSweeper.sweep).toHaveBeenCalledWith('attachments-tmp');
    });
  });

  // -------------------------------------------------------------------------
  // 6. addAllAttachments — socket events
  // -------------------------------------------------------------------------
  describe('addAllAttachments — socket events', () => {
    it('emits AddAttachmentProgress for each processed attachment', async () => {
      const attachments = [
        makeAttachment({ _id: { toString: () => 'a1' } }),
        makeAttachment({ _id: { toString: () => 'a2' } }),
        makeAttachment({ _id: { toString: () => 'a3' } }),
      ];
      await setupAttachmentMock(attachments);

      extractor.extractAttachment.mockResolvedValue({
        kind: 'success' as const,
        pages: [{ pageNumber: 1, label: null, content: 'body' }],
        mimeType: 'text/plain',
      });

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      const { _emit: emit } = socketIoService;

      const progressCalls = emit.mock.calls.filter(
        ([event]) => event === SocketEventName.AddAttachmentProgress,
      );

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0][1]).toEqual({ totalCount: 3, count: 1 });
      expect(progressCalls[1][1]).toEqual({ totalCount: 3, count: 2 });
      expect(progressCalls[2][1]).toEqual({ totalCount: 3, count: 3 });
    });

    it('emits FinishAddAttachment after all attachments are indexed', async () => {
      await setupAttachmentMock([makeAttachment()]);

      extractor.extractAttachment.mockResolvedValue({
        kind: 'success' as const,
        pages: [{ pageNumber: 1, label: null, content: 'text' }],
        mimeType: 'text/plain',
      });

      await batch.addAllAttachments('attachments-tmp', vi.fn());

      const { _emit: emit } = socketIoService;

      const finishCalls = emit.mock.calls.filter(
        ([event]) => event === SocketEventName.FinishAddAttachment,
      );

      expect(finishCalls).toHaveLength(1);
      expect(finishCalls[0][1]).toMatchObject({ totalCount: 1, count: 1 });
    });

    it('emits RebuildingFailed and rethrows when a fatal error occurs', async () => {
      const { Attachment } = await import('~/server/models/attachment');
      const mockedAttachment = Attachment as unknown as {
        countDocuments: ReturnType<typeof vi.fn>;
        find: ReturnType<typeof vi.fn>;
      };

      // Simulate createAttachmentIndex throwing
      delegatorExt.createAttachmentIndex.mockRejectedValueOnce(
        new Error('ES is down'),
      );

      // countDocuments won't even be reached, but mock anyway
      mockedAttachment.countDocuments.mockResolvedValue(0);

      await expect(
        batch.addAllAttachments('attachments-tmp', vi.fn()),
      ).rejects.toThrow('ES is down');

      const { _emit: emit } = socketIoService;
      const failedCalls = emit.mock.calls.filter(
        ([event]) => event === SocketEventName.RebuildingFailed,
      );

      expect(failedCalls).toHaveLength(1);
      expect(failedCalls[0][1]).toMatchObject({ error: 'ES is down' });
    });
  });
});
