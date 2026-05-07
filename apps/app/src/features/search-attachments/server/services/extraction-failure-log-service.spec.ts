import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import type { ExtractionFailureEntry } from '~/features/search-attachments/interfaces/attachment-search';

// Mock the ExtractionFailureLog model before importing the service
vi.mock('../models/extraction-failure-log', () => ({
  ExtractionFailureLog: {
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

// Mock loggerFactory so we can spy on logger.error calls
const mockLoggerError = vi.fn();
vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

/** Build a valid ExtractionFailureEntry for use in tests. */
function makeEntry(
  overrides: Partial<ExtractionFailureEntry> = {},
): ExtractionFailureEntry {
  return {
    attachmentId: 'attach-001',
    pageId: 'page-abc',
    fileName: 'document.pdf',
    fileFormat: 'application/pdf',
    fileSize: 204800,
    reasonCode: 'extractionFailed',
    message: 'Conversion error',
    occurredAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('ExtractionFailureLogService', () => {
  let findOneAndUpdate: MockInstance;
  let find: MockInstance;
  let countDocuments: MockInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Resolve the mocked model methods
    const { ExtractionFailureLog } = await import(
      '../models/extraction-failure-log'
    );
    findOneAndUpdate =
      ExtractionFailureLog.findOneAndUpdate as unknown as MockInstance;
    find = ExtractionFailureLog.find as unknown as MockInstance;
    countDocuments =
      ExtractionFailureLog.countDocuments as unknown as MockInstance;

    // Default successful responses
    findOneAndUpdate.mockResolvedValue(null);
    find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    countDocuments.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getService() {
    const { ExtractionFailureLogService } = await import(
      './extraction-failure-log-service'
    );
    return new ExtractionFailureLogService();
  }

  // -----------------------------------------------------------------------
  // record — dual-path: pino log + MongoDB upsert
  // -----------------------------------------------------------------------
  describe('record', () => {
    it('logs to pino at ERROR level with structured fields', async () => {
      const entry = makeEntry();
      const service = await getService();

      await service.record(entry);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          attachmentId: 'attach-001',
          pageId: 'page-abc',
          fileName: 'document.pdf',
          fileFormat: 'application/pdf',
          fileSize: 204800,
          reasonCode: 'extractionFailed',
          message: 'Conversion error',
          occurredAt: entry.occurredAt,
        }),
        'Attachment text extraction failed',
      );
    });

    it('calls MongoDB findOneAndUpdate with upsert for deduplication', async () => {
      const entry = makeEntry();
      const service = await getService();

      await service.record(entry);

      expect(findOneAndUpdate).toHaveBeenCalledOnce();

      const [filter, update, options] = findOneAndUpdate.mock.calls[0];

      // Filter: by retentionGroupHash + recent window
      expect(filter.retentionGroupHash).toBe('attach-001:extractionFailed');
      expect(filter.occurredAt).toBeDefined();
      expect(filter.occurredAt.$gte).toBeInstanceOf(Date);

      // Update: sets occurredAt always; inserts full doc on first occurrence
      expect(update.$set).toEqual({ occurredAt: entry.occurredAt });
      expect(update.$setOnInsert).toMatchObject({
        attachmentId: 'attach-001',
        pageId: 'page-abc',
        fileName: 'document.pdf',
        fileFormat: 'application/pdf',
        fileSize: 204800,
        reasonCode: 'extractionFailed',
        message: 'Conversion error',
        retentionGroupHash: 'attach-001:extractionFailed',
      });

      // Must be an upsert
      expect(options.upsert).toBe(true);
    });

    it('uses retentionGroupHash = "attachmentId:reasonCode"', async () => {
      const entry = makeEntry({
        attachmentId: 'some-attach',
        reasonCode: 'fileTooLarge',
      });
      const service = await getService();

      await service.record(entry);

      const [filter] = findOneAndUpdate.mock.calls[0];
      expect(filter.retentionGroupHash).toBe('some-attach:fileTooLarge');
    });

    it('sets dedup window filter to ~1 hour before now', async () => {
      const before = new Date(Date.now() - 60 * 60 * 1000 - 500);
      const entry = makeEntry();
      const service = await getService();

      await service.record(entry);

      const [filter] = findOneAndUpdate.mock.calls[0];
      const windowStart: Date = filter.occurredAt.$gte;

      // Window start should be approximately 1 hour ago (within 5 seconds)
      const diff = Math.abs(windowStart.getTime() - before.getTime());
      expect(diff).toBeLessThan(5000);
    });

    it('handles null pageId and null message without error', async () => {
      const entry = makeEntry({ pageId: null, message: null });
      const service = await getService();

      await expect(service.record(entry)).resolves.toBeUndefined();

      const [, update] = findOneAndUpdate.mock.calls[0];
      expect(update.$setOnInsert.pageId).toBe(null);
      expect(update.$setOnInsert.message).toBe(null);
    });

    it('does not throw when MongoDB findOneAndUpdate rejects', async () => {
      findOneAndUpdate.mockRejectedValue(new Error('MongoDB connection error'));

      const entry = makeEntry();
      const service = await getService();

      // Must not throw — error is caught internally
      await expect(service.record(entry)).resolves.toBeUndefined();
    });

    it('still logs to pino even when MongoDB fails', async () => {
      findOneAndUpdate.mockRejectedValue(new Error('DB down'));

      const entry = makeEntry();
      const service = await getService();

      await service.record(entry);

      // First call: the structured extraction failure log
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: 'attach-001' }),
        'Attachment text extraction failed',
      );
    });

    it('logs a second pino error when MongoDB persistence fails', async () => {
      findOneAndUpdate.mockRejectedValue(new Error('DB down'));

      const entry = makeEntry();
      const service = await getService();

      await service.record(entry);

      // Second call: the MongoDB error notice
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          attachmentId: 'attach-001',
        }),
        'Failed to persist extraction failure log to MongoDB',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listRecent
  // -----------------------------------------------------------------------
  describe('listRecent', () => {
    it('queries without since filter when since is omitted', async () => {
      const sortMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockReturnThis();
      const leanMock = vi.fn().mockResolvedValue([]);
      find.mockReturnValue({
        sort: sortMock,
        limit: limitMock,
        lean: leanMock,
      });

      const service = await getService();
      await service.listRecent({ limit: 10 });

      expect(find).toHaveBeenCalledWith({});
    });

    it('queries with occurredAt.$gte filter when since is provided', async () => {
      const since = new Date('2024-01-01T00:00:00Z');
      const sortMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockReturnThis();
      const leanMock = vi.fn().mockResolvedValue([]);
      find.mockReturnValue({
        sort: sortMock,
        limit: limitMock,
        lean: leanMock,
      });

      const service = await getService();
      await service.listRecent({ limit: 5, since });

      expect(find).toHaveBeenCalledWith({
        occurredAt: { $gte: since },
      });
    });

    it('sorts by occurredAt descending', async () => {
      const sortMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockReturnThis();
      const leanMock = vi.fn().mockResolvedValue([]);
      find.mockReturnValue({
        sort: sortMock,
        limit: limitMock,
        lean: leanMock,
      });

      const service = await getService();
      await service.listRecent({ limit: 10 });

      expect(sortMock).toHaveBeenCalledWith({ occurredAt: -1 });
    });

    it('applies the limit', async () => {
      const sortMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockReturnThis();
      const leanMock = vi.fn().mockResolvedValue([]);
      find.mockReturnValue({
        sort: sortMock,
        limit: limitMock,
        lean: leanMock,
      });

      const service = await getService();
      await service.listRecent({ limit: 25 });

      expect(limitMock).toHaveBeenCalledWith(25);
    });

    it('maps MongoDB documents to ExtractionFailureEntry DTOs', async () => {
      const doc = {
        attachmentId: 'a1',
        pageId: 'p1',
        fileName: 'file.pdf',
        fileFormat: 'application/pdf',
        fileSize: 1024,
        reasonCode: 'extractionFailed',
        message: 'some error',
        occurredAt: new Date('2024-03-01T00:00:00Z'),
        retentionGroupHash: 'a1:extractionFailed',
      };
      const sortMock = vi.fn().mockReturnThis();
      const limitMock = vi.fn().mockReturnThis();
      const leanMock = vi.fn().mockResolvedValue([doc]);
      find.mockReturnValue({
        sort: sortMock,
        limit: limitMock,
        lean: leanMock,
      });

      const service = await getService();
      const results = await service.listRecent({ limit: 10 });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        attachmentId: 'a1',
        pageId: 'p1',
        fileName: 'file.pdf',
        fileFormat: 'application/pdf',
        fileSize: 1024,
        reasonCode: 'extractionFailed',
        message: 'some error',
        occurredAt: doc.occurredAt,
      });
      // retentionGroupHash must NOT appear in the public DTO
      expect(
        (results[0] as unknown as Record<string, unknown>).retentionGroupHash,
      ).toBeUndefined();
    });

    it('returns empty array when MongoDB query fails', async () => {
      find.mockImplementation(() => {
        throw new Error('Query error');
      });

      const service = await getService();
      const results = await service.listRecent({ limit: 10 });

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // totalRecent
  // -----------------------------------------------------------------------
  describe('totalRecent', () => {
    it('calls countDocuments with empty filter when since is omitted', async () => {
      countDocuments.mockResolvedValue(42);

      const service = await getService();
      const total = await service.totalRecent();

      expect(countDocuments).toHaveBeenCalledWith({});
      expect(total).toBe(42);
    });

    it('calls countDocuments with occurredAt.$gte filter when since is provided', async () => {
      const since = new Date('2024-06-01T00:00:00Z');
      countDocuments.mockResolvedValue(7);

      const service = await getService();
      const total = await service.totalRecent(since);

      expect(countDocuments).toHaveBeenCalledWith({
        occurredAt: { $gte: since },
      });
      expect(total).toBe(7);
    });

    it('returns 0 when MongoDB countDocuments fails', async () => {
      countDocuments.mockRejectedValue(new Error('Mongo error'));

      const service = await getService();
      const total = await service.totalRecent();

      expect(total).toBe(0);
    });
  });
});
