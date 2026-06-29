import type { ChangeStream, ChangeStreamDocument } from 'mongodb';
import { Types } from 'mongoose';
import { type MockProxy, mock } from 'vitest-mock-extended';

import type { ActivityDocument } from '~/server/models/activity';
import Activity from '~/server/models/activity';
import { configManager } from '~/server/service/config-manager';

import type { AuditlogEsWriter } from '../interfaces/auditlog-es-writer';
import { AuditlogEsSyncStatus } from '../models/auditlog-es-sync-status';
import {
  markUnsyncedAndAdvanceToken,
  markUnsyncedAndClearToken,
} from '../models/auditlog-es-sync-tx';
import { ChangeStreamResumeToken } from '../models/changestream-resume-token';
import { AuditlogChangeStreamService } from './auditlog-changestream';

const { mockError } = vi.hoisted(() => ({
  mockError: vi.fn(),
}));

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockError,
  })),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock(
  '~/features/auditlog-es-sync/server/models/changestream-resume-token',
  () => ({
    ChangeStreamResumeToken: {
      load: vi.fn(),
      upsert: vi.fn(),
      clear: vi.fn(),
    },
  }),
);

vi.mock(
  '~/features/auditlog-es-sync/server/models/auditlog-es-sync-status',
  () => ({
    AuditlogEsSyncStatus: {
      setUnsynced: vi.fn(),
      isUnsynced: vi.fn(),
    },
    AUDITLOG_SYNC_STATUS_KEY: 'auditlogs',
  }),
);

vi.mock(
  '~/features/auditlog-es-sync/server/models/auditlog-es-sync-tx',
  () => ({
    markUnsyncedAndAdvanceToken: vi.fn(),
    markUnsyncedAndClearToken: vi.fn(),
  }),
);

// Minimal fake ChangeStream driven by push(). On close(), rejects any pending next().
class FakeChangeStream {
  closed = false;

  private queue: ChangeStreamDocument<ActivityDocument>[] = [];

  private waiter: {
    resolve: (v: ChangeStreamDocument<ActivityDocument> | null) => void;
    reject: (err: Error) => void;
  } | null = null;

  push(event: ChangeStreamDocument<ActivityDocument>): void {
    if (this.waiter != null) {
      const { resolve } = this.waiter;
      this.waiter = null;
      resolve(event);
    } else {
      this.queue.push(event);
    }
  }

  next(): Promise<ChangeStreamDocument<ActivityDocument> | null> {
    if (this.queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.closed) {
      return Promise.reject(
        Object.assign(new Error('ChangeStream is closed'), {
          name: 'MongoAPIError',
        }),
      );
    }
    return new Promise<ChangeStreamDocument<ActivityDocument> | null>(
      (resolve, reject) => {
        this.waiter = { resolve, reject };
      },
    );
  }

  close(): Promise<void> {
    this.closed = true;
    if (this.waiter != null) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(
        Object.assign(new Error('ChangeStream is closed'), {
          name: 'MongoAPIError',
        }),
      );
    }
    return Promise.resolve();
  }

  pushError(err: Error): void {
    if (this.waiter != null) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(err);
    }
  }
}

const makeInsertEvent = (
  doc: Partial<ActivityDocument>,
  tokenData = 'tok',
): ChangeStreamDocument<ActivityDocument> =>
  ({
    _id: { _data: tokenData },
    operationType: 'insert',
    fullDocument: doc,
  }) as unknown as ChangeStreamDocument<ActivityDocument>;

const makeDeleteEvent = (
  id: Types.ObjectId,
  tokenData = 'tok',
): ChangeStreamDocument<ActivityDocument> =>
  ({
    _id: { _data: tokenData },
    operationType: 'delete',
    documentKey: { _id: id },
  }) as unknown as ChangeStreamDocument<ActivityDocument>;

// Shadow type that mirrors private members of AuditlogChangeStreamService.
// Used by poison-pill tests to drive flushBuffer directly and avoid restart-backoff
// overhead — the public change-stream path would require fake-timer management per
// restart cycle. Rename or signature changes to the private members will surface here.
type ServiceInternals = {
  consecutiveEventFailures: number;
  consecutiveRestarts: number;
  lastFailingToken: unknown;
  initialStartHandled: boolean;
  buffer: ChangeStreamDocument<ActivityDocument>[];
  flushBuffer(): Promise<boolean>;
};

describe('AuditlogChangeStreamService', () => {
  let esWriter: MockProxy<AuditlogEsWriter>;
  let service: AuditlogChangeStreamService;

  beforeEach(() => {
    esWriter = mock<AuditlogEsWriter>();
    vi.mocked(configManager.getConfig).mockReturnValue(true);
    vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(null);
    vi.mocked(ChangeStreamResumeToken.upsert).mockResolvedValue(undefined);
    vi.mocked(ChangeStreamResumeToken.clear).mockResolvedValue(undefined);
    vi.mocked(AuditlogEsSyncStatus.setUnsynced).mockResolvedValue(undefined);
    vi.mocked(AuditlogEsSyncStatus.isUnsynced).mockResolvedValue(false);
    vi.mocked(markUnsyncedAndAdvanceToken).mockResolvedValue(undefined);
    vi.mocked(markUnsyncedAndClearToken).mockResolvedValue(undefined);
    esWriter.bulkSyncAuditlogs.mockResolvedValue(undefined);
    // Default: no activities exist (fresh install). Tests that need a backlog override this.
    vi.spyOn(Activity, 'exists').mockResolvedValue(null);
  });

  afterEach(async () => {
    await service?.close();
    vi.restoreAllMocks();
  });

  // Drives n consecutive flush attempts via ServiceInternals, bypassing the change-stream
  // loop to avoid restart-backoff overhead. Used by poison-pill and counter-separation tests.
  const driveFlushes = async (
    internal: ServiceInternals,
    n: number,
    tokenData: string,
  ): Promise<boolean> => {
    let last = false;
    for (let i = 0; i < n; i++) {
      internal.buffer = [makeInsertEvent({}, tokenData)];
      // biome-ignore lint/performance/noAwaitInLoops: intentional sequential calls via ServiceInternals
      last = await internal.flushBuffer.call(service);
    }
    return last;
  };

  // ─── start() options ───────────────────────────────────────────────────────

  describe('start()', () => {
    it('does not open a Change Stream when auditLogEnabled is false', async () => {
      vi.mocked(configManager.getConfig).mockReturnValue(false);
      service = new AuditlogChangeStreamService(esWriter);
      const watchSpy = vi.spyOn(Activity, 'watch');

      await service.start();

      expect(watchSpy).not.toHaveBeenCalled();
    });

    it('opens Activity.watch without resumeAfter when no resume token exists', async () => {
      vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(null);
      const fakeStream = new FakeChangeStream();
      const watchSpy = vi
        .spyOn(Activity, 'watch')
        .mockReturnValue(
          fakeStream as unknown as ChangeStream<ActivityDocument>,
        );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      expect(watchSpy).toHaveBeenCalledWith([], {});
    });

    it('opens Activity.watch with resumeAfter when a resume token exists', async () => {
      const token = { _data: 'stored-token' };
      vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(token);
      const fakeStream = new FakeChangeStream();
      const watchSpy = vi
        .spyOn(Activity, 'watch')
        .mockReturnValue(
          fakeStream as unknown as ChangeStream<ActivityDocument>,
        );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      expect(watchSpy).toHaveBeenCalledWith([], { resumeAfter: token });
    });
  });

  // ─── reconcileInitialSyncState() ──────────────────────────────────────────

  describe('reconcileInitialSyncState()', () => {
    it('clears resume token and calls setUnsynced(false) when didRebuildOnBoot is true', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter, true);

      await service.start();

      expect(vi.mocked(ChangeStreamResumeToken.clear)).toHaveBeenCalledWith(
        'auditlogs',
      );
      expect(vi.mocked(AuditlogEsSyncStatus.setUnsynced)).toHaveBeenCalledWith(
        false,
      );
    });

    it('calls setUnsynced(true) when no token and Activities exist', async () => {
      vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(null);
      vi.spyOn(Activity, 'exists').mockResolvedValue({
        _id: new Types.ObjectId(),
      });
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter, false);

      await service.start();

      expect(vi.mocked(AuditlogEsSyncStatus.setUnsynced)).toHaveBeenCalledWith(
        true,
      );
    });

    it('does not call setUnsynced when no token and no Activities (fresh install)', async () => {
      vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(null);
      vi.spyOn(Activity, 'exists').mockResolvedValue(null);
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter, false);

      await service.start();

      expect(
        vi.mocked(AuditlogEsSyncStatus.setUnsynced),
      ).not.toHaveBeenCalled();
    });

    it('does not call setUnsynced and resumes from existing token when token exists', async () => {
      const token = { _data: 'existing-token' };
      vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(token);
      const fakeStream = new FakeChangeStream();
      const watchSpy = vi
        .spyOn(Activity, 'watch')
        .mockReturnValue(
          fakeStream as unknown as ChangeStream<ActivityDocument>,
        );
      service = new AuditlogChangeStreamService(esWriter, false);

      await service.start();

      expect(
        vi.mocked(AuditlogEsSyncStatus.setUnsynced),
      ).not.toHaveBeenCalled();
      expect(watchSpy).toHaveBeenCalledWith([], { resumeAfter: token });
    });

    it('does not re-run reconcile on restart (initialStartHandled guard)', async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(ChangeStreamResumeToken.load).mockResolvedValue(null);
        vi.spyOn(Activity, 'exists').mockResolvedValue({
          _id: new Types.ObjectId(),
        });
        const fakeStream = new FakeChangeStream();
        vi.spyOn(Activity, 'watch')
          .mockImplementationOnce(() => {
            throw new Error('transient error');
          })
          .mockReturnValue(
            fakeStream as unknown as ChangeStream<ActivityDocument>,
          );
        service = new AuditlogChangeStreamService(esWriter, false);

        // restart() calls start() on the same instance — reconcile must not re-run
        await service.startWithRetry();
        await vi.runAllTimersAsync();

        expect(
          vi.mocked(AuditlogEsSyncStatus.setUnsynced),
        ).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── processChangeStream() event handling (via flushBuffer internals) ─────

  describe('processChangeStream() event handling', () => {
    it('calls bulkSyncAuditlogs with the full document for an insert event', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      const doc: Partial<ActivityDocument> = { _id: new Types.ObjectId() };
      fakeStream.push(makeInsertEvent(doc, 'tok1'));

      await vi.waitFor(() =>
        expect(esWriter.bulkSyncAuditlogs).toHaveBeenCalledWith([doc], []),
      );
    });

    it('calls bulkSyncAuditlogs with the document key for a delete event', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      const id = new Types.ObjectId();
      fakeStream.push(makeDeleteEvent(id, 'tok1'));

      await vi.waitFor(() =>
        expect(esWriter.bulkSyncAuditlogs).toHaveBeenCalledWith([], [id]),
      );
    });

    it('does not persist resume token when ES sync fails (at-least-once)', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      esWriter.bulkSyncAuditlogs.mockRejectedValue(new Error('ES down'));
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      const doc: Partial<ActivityDocument> = { _id: new Types.ObjectId() };
      fakeStream.push(makeInsertEvent(doc, 'tok1'));

      // confirm flush completed before asserting the negative
      await vi.waitFor(() =>
        expect(esWriter.bulkSyncAuditlogs).toHaveBeenCalled(),
      );
      expect(vi.mocked(ChangeStreamResumeToken.upsert)).not.toHaveBeenCalled();
    });

    it('persists resume token at the batch boundary after a successful flush', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      const doc: Partial<ActivityDocument> = { _id: new Types.ObjectId() };
      fakeStream.push(makeInsertEvent(doc, 'tok1'));

      await vi.waitFor(() =>
        expect(vi.mocked(ChangeStreamResumeToken.upsert)).toHaveBeenCalledWith(
          'auditlogs',
          { _data: 'tok1' },
        ),
      );
    });

    it('persists only the last event token when multiple events are batched together (H-1)', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      fakeStream.push(makeInsertEvent({}, 'tok1'));
      fakeStream.push(makeInsertEvent({}, 'tok2'));
      fakeStream.push(makeInsertEvent({}, 'tok3'));

      await vi.waitFor(() =>
        expect(vi.mocked(ChangeStreamResumeToken.upsert)).toHaveBeenCalled(),
      );
      expect(vi.mocked(ChangeStreamResumeToken.upsert)).toHaveBeenCalledTimes(
        1,
      );
      expect(vi.mocked(ChangeStreamResumeToken.upsert)).toHaveBeenCalledWith(
        'auditlogs',
        { _data: 'tok3' },
      );
    });
  });

  // ─── Poison pill skip ──────────────────────────────────────────────────────

  describe('poison pill skip (MAX_CONSECUTIVE_EVENT_FAILURES)', () => {
    it('calls markUnsyncedAndAdvanceToken after MAX consecutive failures on the same token', async () => {
      service = new AuditlogChangeStreamService(esWriter);
      const internal = service as unknown as ServiceInternals;
      esWriter.bulkSyncAuditlogs.mockRejectedValue(new Error('ES error'));

      await driveFlushes(internal, 8, 'tok-poison');

      expect(vi.mocked(markUnsyncedAndAdvanceToken)).toHaveBeenCalledWith(
        'auditlogs',
        { _data: 'tok-poison' },
      );
    });

    it('logs an error message when skipping a poison pill batch', async () => {
      service = new AuditlogChangeStreamService(esWriter);
      const internal = service as unknown as ServiceInternals;
      const esError = new Error('permanent ES error');
      esWriter.bulkSyncAuditlogs.mockRejectedValue(esError);

      await driveFlushes(internal, 8, 'tok-poison');

      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ err: esError }),
        'Skipping poison pill batch after consecutive failures.',
      );
    });

    it('returns true after skipping a poison pill batch', async () => {
      service = new AuditlogChangeStreamService(esWriter);
      const internal = service as unknown as ServiceInternals;
      esWriter.bulkSyncAuditlogs.mockRejectedValue(new Error('ES error'));

      const result = await driveFlushes(internal, 8, 'tok-poison');

      expect(result).toBe(true);
    });

    it('resets failure count after a skip — next 8 failures on a new token trigger another skip', async () => {
      service = new AuditlogChangeStreamService(esWriter);
      const internal = service as unknown as ServiceInternals;
      esWriter.bulkSyncAuditlogs.mockRejectedValue(new Error('ES error'));

      await driveFlushes(internal, 8, 'tok-poison');
      vi.mocked(markUnsyncedAndAdvanceToken).mockClear();

      // If the counter was NOT reset, the skip would fire on the very first new-token failure.
      // If it WAS reset, the skip fires only on the 8th new-token failure.
      await driveFlushes(internal, 8, 'tok-next');

      expect(vi.mocked(markUnsyncedAndAdvanceToken)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(markUnsyncedAndAdvanceToken)).toHaveBeenCalledWith(
        'auditlogs',
        { _data: 'tok-next' },
      );
    });
  });

  // ─── Token-based failure counter separation (M-B) ─────────────────────────

  describe('failure counter separation (M-B)', () => {
    it('does not skip when a different token interrupts before reaching MAX failures', async () => {
      service = new AuditlogChangeStreamService(esWriter);
      const internal = service as unknown as ServiceInternals;
      esWriter.bulkSyncAuditlogs.mockRejectedValue(new Error('ES error'));

      // 7 failures on tok-a (one short of the MAX=8 threshold)
      await driveFlushes(internal, 7, 'tok-a');

      // 1 failure on tok-b resets the counter
      internal.buffer = [makeInsertEvent({}, 'tok-b')];
      await internal.flushBuffer.call(service);

      // 6 more failures on tok-b (1 + 6 = 7 total; skip fires on the 8th)
      await driveFlushes(internal, 6, 'tok-b');

      // After 7 tok-a + 1 tok-b + 6 tok-b = 14 calls, skip should NOT have fired yet
      expect(vi.mocked(markUnsyncedAndAdvanceToken)).not.toHaveBeenCalled();

      // The 8th tok-b failure triggers the skip
      internal.buffer = [makeInsertEvent({}, 'tok-b')];
      await internal.flushBuffer.call(service);

      expect(vi.mocked(markUnsyncedAndAdvanceToken)).toHaveBeenCalledWith(
        'auditlogs',
        { _data: 'tok-b' },
      );
    });
  });

  // ─── HistoryLost handling ─────────────────────────────────────────────────

  describe('HistoryLost handling', () => {
    it('calls markUnsyncedAndClearToken when ChangeStreamHistoryLost is thrown by the stream', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();

      // Simulate a HistoryLost error from the stream (caught by outer try/catch)
      const historyLostErr = Object.assign(
        new Error('Resume of change stream was not possible'),
        {
          code: 286,
        },
      );
      // Reject the pending next() with HistoryLost so the outer catch fires
      fakeStream.pushError(historyLostErr);

      await vi.waitFor(() =>
        expect(vi.mocked(markUnsyncedAndClearToken)).toHaveBeenCalledWith(
          'auditlogs',
        ),
      );
    });

    it('stops permanently and does not restart when markUnsyncedAndClearToken throws after HistoryLost', async () => {
      vi.useFakeTimers();
      try {
        const fakeStream = new FakeChangeStream();
        const watchSpy = vi
          .spyOn(Activity, 'watch')
          .mockReturnValue(
            fakeStream as unknown as ChangeStream<ActivityDocument>,
          );
        vi.mocked(markUnsyncedAndClearToken).mockRejectedValue(
          new Error('tx failed'),
        );
        service = new AuditlogChangeStreamService(esWriter);

        await service.start();

        const historyLostErr = Object.assign(
          new Error('Resume of change stream was not possible'),
          { code: 286 },
        );
        fakeStream.pushError(historyLostErr);

        // Wait for markUnsyncedAndClearToken to have been attempted
        await vi.waitFor(() =>
          expect(vi.mocked(markUnsyncedAndClearToken)).toHaveBeenCalled(),
        );

        // Advance past RESTART_BASE_DELAY_MS — no restart must occur
        await vi.runAllTimersAsync();

        expect(watchSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── close() / stopped flag ───────────────────────────────────────────────

  describe('close()', () => {
    it('closes the underlying ChangeStream', async () => {
      const fakeStream = new FakeChangeStream();
      vi.spyOn(Activity, 'watch').mockReturnValue(
        fakeStream as unknown as ChangeStream<ActivityDocument>,
      );
      service = new AuditlogChangeStreamService(esWriter);

      await service.start();
      await service.close();

      expect(fakeStream.closed).toBe(true);
    });

    it('does not restart processChangeStream after close()', async () => {
      vi.useFakeTimers();
      try {
        const fakeStream = new FakeChangeStream();
        const watchSpy = vi
          .spyOn(Activity, 'watch')
          .mockReturnValue(
            fakeStream as unknown as ChangeStream<ActivityDocument>,
          );
        service = new AuditlogChangeStreamService(esWriter);

        await service.start();
        await service.close();

        // Advance past RESTART_BASE_DELAY_MS
        await vi.runAllTimersAsync();

        expect(watchSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── startWithRetry() ─────────────────────────────────────────────────────

  describe('startWithRetry()', () => {
    it('does not trigger restart when start() succeeds', async () => {
      const fakeStream = new FakeChangeStream();
      const watchSpy = vi
        .spyOn(Activity, 'watch')
        .mockReturnValue(
          fakeStream as unknown as ChangeStream<ActivityDocument>,
        );
      service = new AuditlogChangeStreamService(esWriter);

      await service.startWithRetry();

      // Only one watch call; no restart re-opened the stream
      expect(watchSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers restart when start() throws, and retries after backoff', async () => {
      vi.useFakeTimers();
      try {
        const fakeStream = new FakeChangeStream();
        const watchSpy = vi
          .spyOn(Activity, 'watch')
          .mockImplementationOnce(() => {
            throw new Error('watch failed');
          })
          .mockReturnValue(
            fakeStream as unknown as ChangeStream<ActivityDocument>,
          );
        service = new AuditlogChangeStreamService(esWriter);

        await service.startWithRetry();

        // Advance past the 1-second backoff delay (RESTART_BASE_DELAY_MS)
        await vi.runAllTimersAsync();

        expect(watchSpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
        await service.close();
      }
    });

    it('does not call setUnsynced(true) when start() throws transiently', async () => {
      vi.useFakeTimers();
      try {
        const fakeStream = new FakeChangeStream();
        vi.spyOn(Activity, 'watch')
          .mockImplementationOnce(() => {
            throw new Error('transient error');
          })
          .mockReturnValue(
            fakeStream as unknown as ChangeStream<ActivityDocument>,
          );
        service = new AuditlogChangeStreamService(esWriter);

        await service.startWithRetry();
        await vi.runAllTimersAsync();

        expect(
          vi.mocked(AuditlogEsSyncStatus.setUnsynced),
        ).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
        await service.close();
      }
    });

    it('returns normally without restart when auditLogEnabled is false', async () => {
      vi.mocked(configManager.getConfig).mockReturnValue(false);
      const watchSpy = vi.spyOn(Activity, 'watch');
      service = new AuditlogChangeStreamService(esWriter);

      await service.startWithRetry();

      expect(watchSpy).not.toHaveBeenCalled();
    });
  });
});
