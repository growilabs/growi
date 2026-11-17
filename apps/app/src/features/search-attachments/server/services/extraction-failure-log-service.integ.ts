import mongoose from 'mongoose';

import type { ExtractionFailureEntry } from '~/features/search-attachments/interfaces/attachment-search';
import { prisma } from '~/utils/prisma';

import { ExtractionFailureLogService } from './extraction-failure-log-service';

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const HOUR_MS = 60 * 60 * 1000;

const objectId = (): string => new mongoose.Types.ObjectId().toString();

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60 * 1000);

const makeEntry = (
  overrides: Partial<ExtractionFailureEntry> = {},
): ExtractionFailureEntry => ({
  attachmentId: objectId(),
  pageId: objectId(),
  fileName: 'document.pdf',
  fileFormat: 'application/pdf',
  fileSize: 204800,
  reasonCode: 'extractionFailed',
  message: 'Conversion error',
  occurredAt: new Date(),
  ...overrides,
});

describe('ExtractionFailureLogService', () => {
  const service = new ExtractionFailureLogService();

  afterEach(async () => {
    await prisma.extractionfailurelogs.deleteMany({});
  });

  it('does not register a Mongoose model, so loading it creates no collection or index', () => {
    expect(mongoose.modelNames()).not.toContain('ExtractionFailureLog');
  });

  describe('record', () => {
    it('stores a failure that listRecent returns without its internal fields', async () => {
      const entry = makeEntry({ pageId: null, message: null });

      await service.record(entry);

      expect(await service.listRecent({ limit: 10 })).toEqual([entry]);
    });

    it('keeps one entry for the same attachment and reason within an hour, with the latest time', async () => {
      const entry = makeEntry({ occurredAt: minutesAgo(30) });
      const latest = new Date();

      await service.record(entry);
      await service.record({ ...entry, occurredAt: latest });

      expect(await service.listRecent({ limit: 10 })).toEqual([
        { ...entry, occurredAt: latest },
      ]);
    });

    it('stores a separate entry for another reason of the same attachment', async () => {
      const entry = makeEntry({ occurredAt: minutesAgo(1) });

      await service.record(entry);
      await service.record({ ...entry, reasonCode: 'fileTooLarge' });

      expect(await service.totalRecent()).toBe(2);
    });

    it('stores a new entry when the previous one for the same pair is older than an hour', async () => {
      const entry = makeEntry();
      await service.record({
        ...entry,
        occurredAt: new Date(Date.now() - 2 * HOUR_MS),
      });

      await service.record(entry);

      expect(await service.totalRecent()).toBe(2);
    });

    it('does not throw when the database write fails', async () => {
      // An id the database refuses makes the write fail
      const entry = makeEntry({ attachmentId: 'not-an-object-id' });

      await expect(service.record(entry)).resolves.toBeUndefined();
      expect(await service.totalRecent()).toBe(0);
    });
  });

  describe('listRecent and totalRecent', () => {
    const recordAt = async (minutes: number): Promise<Date> => {
      const occurredAt = minutesAgo(minutes);
      await service.record(makeEntry({ occurredAt }));
      return occurredAt;
    };

    it('lists the newest first, up to the limit', async () => {
      await recordAt(30);
      const newest = await recordAt(10);
      const middle = await recordAt(20);

      const items = await service.listRecent({ limit: 2 });

      expect(items.map((item) => item.occurredAt)).toEqual([newest, middle]);
      expect(await service.totalRecent()).toBe(3);
    });

    it('lists and counts only the entries at or after since', async () => {
      await recordAt(30);
      const since = await recordAt(20);
      const newer = await recordAt(10);

      const items = await service.listRecent({ limit: 10, since });

      expect(items.map((item) => item.occurredAt)).toEqual([newer, since]);
      expect(await service.totalRecent(since)).toBe(2);
    });
  });
});
