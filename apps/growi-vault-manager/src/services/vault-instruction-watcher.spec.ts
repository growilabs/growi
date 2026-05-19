/**
 * Unit tests for VaultInstructionWatcher.
 *
 * All external dependencies (Mongoose models, VaultNamespaceBuilder) are mocked
 * with vi.mock so tests run without a real MongoDB connection.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before any import that triggers the module graph)
// ---------------------------------------------------------------------------

// Fake change stream that extends EventEmitter so we can emit events manually.
class FakeChangeStream extends EventEmitter {
  closed = false;
  // biome-ignore lint/suspicious/useAwait: mirrors the real ChangeStream.close() async signature
  async close() {
    this.closed = true;
  }
}

// Mock VaultInstructionModel
const mockDrainCursor = vi.fn();
const mockWatchInserts = vi.fn();
const mockFindById = vi.fn();

vi.mock('../models/vault-instruction.js', () => ({
  VaultInstructionModel: {
    drainCursor: mockDrainCursor,
    watchInserts: mockWatchInserts,
    findById: mockFindById,
  },
}));

// Mock @growi/logger
const mockLoggerError = vi.fn();

vi.mock('@growi/logger', () => ({
  loggerFactory: () => ({
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock VaultSyncStateModel
const mockGetSingleton = vi.fn();
const mockSaveResumeToken = vi.fn();
const mockUpdateWatcherFields = vi.fn();

vi.mock('../models/vault-sync-state.js', () => ({
  VaultSyncStateModel: {
    getSingleton: mockGetSingleton,
    saveResumeToken: mockSaveResumeToken,
    updateWatcherFields: mockUpdateWatcherFields,
  },
}));

// Mock VaultNamespaceBuilder
const mockApplyInstruction = vi.fn();

vi.mock('./vault-namespace-builder.js', () => ({
  applyInstruction: mockApplyInstruction,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake Mongoose document that mimics IVaultInstructionDocument.
 */
function makeDoc(opts: { id?: string; processedAt?: Date | null }): {
  _id: string;
  processedAt: Date | null;
  op: string;
  payload: object;
  issuedAt: Date;
  attempts: number;
  lastError: string | null;
  markProcessed: ReturnType<typeof vi.fn>;
  recordFailure: ReturnType<typeof vi.fn>;
} {
  return {
    _id: opts.id ?? 'doc-id-1',
    processedAt: opts.processedAt ?? null,
    op: 'upsert',
    payload: {
      namespace: 'ns1',
      pageId: 'p1',
      pagePath: '/Page',
      revisionId: 'r1',
    },
    issuedAt: new Date(),
    attempts: 0,
    lastError: null,
    markProcessed: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Builds an async cursor over the provided documents.
 */
function makeCursor(docs: object[]) {
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        // biome-ignore lint/suspicious/useAwait: AsyncIterator.next() must return a Promise to satisfy the protocol
        async next() {
          if (index < docs.length) {
            return { value: docs[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/**
 * Returns a drainCursor stub that yields the supplied documents.
 */
function stubDrainCursor(docs: object[]) {
  return {
    cursor: () => makeCursor(docs),
  };
}

// ---------------------------------------------------------------------------
// Import SUT (after mocks are registered)
// ---------------------------------------------------------------------------

// Dynamic import ensures the module sees the mocked dependencies.
async function getSut() {
  const { createVaultInstructionWatcher } = await import(
    './vault-instruction-watcher.js'
  );
  return createVaultInstructionWatcher;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultInstructionWatcher', () => {
  let fakeStream: FakeChangeStream;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerError.mockReset();

    fakeStream = new FakeChangeStream();
    mockWatchInserts.mockReturnValue(fakeStream);
    mockGetSingleton.mockResolvedValue(null); // no saved resumeToken by default
    mockSaveResumeToken.mockResolvedValue(undefined);
    mockUpdateWatcherFields.mockResolvedValue(undefined);
    mockApplyInstruction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 9.1 — Drain on startup
  // -------------------------------------------------------------------------

  describe('start() — drain', () => {
    it('processes unprocessed instructions (processedAt: null) during drain', async () => {
      const doc = makeDoc({ processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockFindById.mockResolvedValue(doc);

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(mockApplyInstruction).toHaveBeenCalledOnce();
      expect(doc.markProcessed).toHaveBeenCalledOnce();
      expect(mockUpdateWatcherFields).toHaveBeenCalledWith(
        expect.objectContaining({ lastProcessedAt: expect.any(Date) }),
      );
    });

    it('processes multiple drain documents in order', async () => {
      const doc1 = makeDoc({ id: 'id-1', processedAt: null });
      const doc2 = makeDoc({ id: 'id-2', processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc1, doc2]));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(mockApplyInstruction).toHaveBeenCalledTimes(2);
      expect(doc1.markProcessed).toHaveBeenCalledOnce();
      expect(doc2.markProcessed).toHaveBeenCalledOnce();
    });

    it('opens the change stream without resumeToken when none is stored', async () => {
      mockGetSingleton.mockResolvedValue(null);
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(mockWatchInserts).toHaveBeenCalledWith(undefined);
    });

    it('opens the change stream with the stored resumeToken', async () => {
      const token = { _data: 'resume-token-abc' };
      mockGetSingleton.mockResolvedValue({ resumeToken: token });
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(mockWatchInserts).toHaveBeenCalledWith(token);
    });
  });

  // -------------------------------------------------------------------------
  // 9.1 — Idempotency
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    it('skips instructions with processedAt already set (drain path)', async () => {
      const doc = makeDoc({ processedAt: new Date() });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      // applyInstruction must not be called for an already-processed instruction.
      expect(mockApplyInstruction).not.toHaveBeenCalled();
      expect(doc.markProcessed).not.toHaveBeenCalled();
    });

    it('skips instructions with processedAt set received via change stream', async () => {
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      // The live document returned by findById has processedAt set.
      const liveDoc = makeDoc({ processedAt: new Date() });
      mockFindById.mockResolvedValue(liveDoc);

      const createWatcher = await getSut();
      const watcher = createWatcher();

      // start() awaits drain; after that we can emit change stream events.
      const startPromise = watcher.start();
      await startPromise;

      // Emit a change stream insert event.
      fakeStream.emit('change', {
        _id: { _data: 'token-1' },
        fullDocument: { _id: 'doc-id-1' },
      });

      // Give the event handler a tick to run.
      await new Promise((r) => setImmediate(r));

      expect(mockApplyInstruction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 9.2 — Failure / retry handling
  // -------------------------------------------------------------------------

  describe('failure handling (task 9.2)', () => {
    it('records failure and keeps processedAt null when applyInstruction throws (drain)', async () => {
      const doc = makeDoc({ processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('git error'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      // recordFailure must be called with the error message.
      expect(doc.recordFailure).toHaveBeenCalledWith('git error');
      // markProcessed must NOT be called.
      expect(doc.markProcessed).not.toHaveBeenCalled();
      // processedAt remains null — the doc object is unchanged.
      expect(doc.processedAt).toBeNull();
    });

    it('increments attempts implicitly through recordFailure on repeated failure', async () => {
      const doc = makeDoc({ processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('transient failure'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(doc.recordFailure).toHaveBeenCalledOnce();
      // The model method recordFailure internally does $inc attempts — verified
      // at the model level; here we assert the watcher calls it.
      expect(doc.recordFailure).toHaveBeenCalledWith('transient failure');
    });

    it('sets processedAt only on success, not on failure', async () => {
      const doc = makeDoc({ processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      // Fail first call, succeed second.
      mockApplyInstruction
        .mockRejectedValueOnce(new Error('first failure'))
        .mockResolvedValue(undefined);

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      // First drain pass: failure.
      expect(doc.recordFailure).toHaveBeenCalledWith('first failure');
      expect(doc.markProcessed).not.toHaveBeenCalled();
    });

    it('processes successfully on retry (processedAt updated on success)', async () => {
      const doc = makeDoc({ processedAt: null });
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockResolvedValue(undefined);

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(doc.markProcessed).toHaveBeenCalledOnce();
      expect(doc.recordFailure).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 13.3 — Dead-letter detection
  // -------------------------------------------------------------------------

  describe('dead-letter detection (task 13.3)', () => {
    it('emits logger.error when attempts reaches 5 (doc.attempts === 4 before failure)', async () => {
      // attempts is 4 before this failure — recordFailure will make it 5.
      const doc = makeDoc({ processedAt: null });
      doc.attempts = 4;
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('persistent error'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(doc.recordFailure).toHaveBeenCalledWith('persistent error');
      expect(mockLoggerError).toHaveBeenCalledOnce();
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          instructionId: String(doc._id),
          attempts: 5,
        }),
        expect.any(String),
      );
    });

    it('does NOT emit logger.error when attempts is below the threshold (doc.attempts === 3)', async () => {
      // attempts is 3 before this failure — recordFailure will make it 4, below threshold.
      const doc = makeDoc({ processedAt: null });
      doc.attempts = 3;
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('transient'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(doc.recordFailure).toHaveBeenCalledOnce();
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('does NOT emit logger.error on the first failure (doc.attempts === 0)', async () => {
      const doc = makeDoc({ processedAt: null });
      doc.attempts = 0;
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('first failure'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('does NOT emit logger.error again when already past threshold (doc.attempts === 5)', async () => {
      // attempts is already 5 — recordFailure will make it 6 (beyond threshold).
      // The log must NOT fire again to prevent flooding on subsequent retries.
      const doc = makeDoc({ processedAt: null });
      doc.attempts = 5;
      mockDrainCursor.mockReturnValue(stubDrainCursor([doc]));
      mockApplyInstruction.mockRejectedValue(new Error('still failing'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      expect(doc.recordFailure).toHaveBeenCalledOnce();
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Change stream events (post-drain)
  // -------------------------------------------------------------------------

  describe('change stream event handling (post-drain)', () => {
    it('processes a change stream event after drain and saves the resume token', async () => {
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      const liveDoc = makeDoc({ processedAt: null });
      mockFindById.mockResolvedValue(liveDoc);

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      const resumeToken = { _data: 'token-post-drain' };
      fakeStream.emit('change', {
        _id: resumeToken,
        fullDocument: { _id: 'doc-id-1' },
      });

      await new Promise((r) => setImmediate(r));

      expect(mockApplyInstruction).toHaveBeenCalledOnce();
      expect(liveDoc.markProcessed).toHaveBeenCalledOnce();
      expect(mockSaveResumeToken).toHaveBeenCalledWith(resumeToken);
    });

    it('records failure when change stream event processing fails', async () => {
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      const liveDoc = makeDoc({ processedAt: null });
      mockFindById.mockResolvedValue(liveDoc);
      mockApplyInstruction.mockRejectedValue(new Error('stream error'));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();

      fakeStream.emit('change', {
        _id: { _data: 'tok' },
        fullDocument: { _id: 'doc-id-1' },
      });

      await new Promise((r) => setImmediate(r));

      expect(liveDoc.recordFailure).toHaveBeenCalledWith('stream error');
      expect(liveDoc.markProcessed).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('closes the change stream when stop() is called', async () => {
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();
      await watcher.stop();

      expect(fakeStream.closed).toBe(true);
    });

    it('does not process new change stream events after stop()', async () => {
      mockDrainCursor.mockReturnValue(stubDrainCursor([]));
      const liveDoc = makeDoc({ processedAt: null });
      mockFindById.mockResolvedValue(liveDoc);

      const createWatcher = await getSut();
      const watcher = createWatcher();
      await watcher.start();
      await watcher.stop();

      // Emit after stop — should be ignored.
      fakeStream.emit('change', {
        _id: { _data: 'tok' },
        fullDocument: { _id: 'doc-id-1' },
      });

      await new Promise((r) => setImmediate(r));

      expect(mockApplyInstruction).not.toHaveBeenCalled();
    });
  });
});
