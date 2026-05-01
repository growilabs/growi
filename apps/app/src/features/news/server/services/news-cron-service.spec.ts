// Hoisted mocks
const mocks = vi.hoisted(() => {
  const upsertNewsItems = vi.fn();
  const deleteNewsItemsByExternalIds = vi.fn();
  const mockFetch = vi.fn();
  const getGrowiVersion = vi.fn(() => '7.5.0');

  return {
    NewsService: vi.fn(() => ({
      upsertNewsItems,
      deleteNewsItemsByExternalIds,
    })),
    upsertNewsItems,
    deleteNewsItemsByExternalIds,
    mockFetch,
    getGrowiVersion,
  };
});

vi.mock('../services/news-service', () => ({
  NewsService: mocks.NewsService,
}));

vi.mock('~/utils/growi-version', () => ({
  getGrowiVersion: mocks.getGrowiVersion,
}));

// Mock global fetch
vi.stubGlobal('fetch', mocks.mockFetch);

// Mock Math.random for deterministic sleep (zero sleep)
vi.spyOn(Math, 'random').mockReturnValue(0);

import { NewsCronService } from './news-cron-service';

const VALID_FEED = {
  version: '1.0',
  items: [
    {
      id: 'item-001',
      title: { ja_JP: 'テスト', en_US: 'Test' },
      publishedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'item-002',
      title: { ja_JP: '管理者向け' },
      publishedAt: '2026-01-02T00:00:00Z',
      conditions: { targetRoles: ['admin'] },
    },
  ],
};

/** Build a Response-like mock that exposes `text()` returning the JSON-stringified body. */
const mockResponse = (
  body: unknown,
  init?: { ok?: boolean; status?: number },
) => ({
  ok: init?.ok ?? true,
  status: init?.status ?? 200,
  text: () => Promise.resolve(JSON.stringify(body)),
});

describe('NewsCronService', () => {
  let service: NewsCronService;
  const originalEnv = process.env.NEWS_FEED_URL;

  beforeEach(() => {
    service = new NewsCronService();
    vi.clearAllMocks();
    // Reset random mock
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    process.env.NEWS_FEED_URL = originalEnv;
  });

  describe('getCronSchedule', () => {
    test('should return daily schedule at midnight', () => {
      expect(service.getCronSchedule()).toBe('0 0 * * *');
    });
  });

  describe('executeJob', () => {
    test('should skip when NEWS_FEED_URL is not set', async () => {
      delete process.env.NEWS_FEED_URL;

      await service.executeJob();

      expect(mocks.mockFetch).not.toHaveBeenCalled();
      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
    });

    test('should skip when NEWS_FEED_URL is empty string', async () => {
      process.env.NEWS_FEED_URL = '';

      await service.executeJob();

      expect(mocks.mockFetch).not.toHaveBeenCalled();
    });

    test('should skip when NEWS_FEED_URL uses non-allowed http', async () => {
      process.env.NEWS_FEED_URL = 'http://example.com/feed.json';

      await service.executeJob();

      expect(mocks.mockFetch).not.toHaveBeenCalled();
    });

    test('should allow https:// URLs', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.mockFetch).toHaveBeenCalledWith(
        'https://example.com/feed.json',
        expect.any(Object),
      );
    });

    test('should allow http://localhost URLs', async () => {
      process.env.NEWS_FEED_URL = 'http://localhost:8099/feed.json';
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.mockFetch).toHaveBeenCalled();
    });

    test('should allow http://127.0.0.1 URLs', async () => {
      process.env.NEWS_FEED_URL = 'http://127.0.0.1:8099/feed.json';
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.mockFetch).toHaveBeenCalled();
    });

    test('should upsert items on successful fetch', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.upsertNewsItems).toHaveBeenCalledWith(VALID_FEED.items);
      expect(mocks.deleteNewsItemsByExternalIds).toHaveBeenCalledWith([]);
    });

    test('should NOT update DB when fetch fails', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
      expect(mocks.deleteNewsItemsByExternalIds).not.toHaveBeenCalled();
    });

    test('should NOT update DB when fetch throws', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.executeJob()).resolves.not.toThrow();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
    });

    test('should filter items by growiVersionRegExps', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.getGrowiVersion.mockReturnValue('7.5.0');
      const feedWithVersionFilter = {
        version: '1.0',
        items: [
          {
            id: 'match-item',
            title: { ja_JP: 'バージョン一致' },
            publishedAt: '2026-01-01T00:00:00Z',
            conditions: { growiVersionRegExps: ['^7\\.5\\..*'] },
          },
          {
            id: 'no-match-item',
            title: { ja_JP: 'バージョン不一致' },
            publishedAt: '2026-01-01T00:00:00Z',
            conditions: { growiVersionRegExps: ['^6\\..*'] },
          },
        ],
      };
      mocks.mockFetch.mockResolvedValue(mockResponse(feedWithVersionFilter));

      await service.executeJob();

      const upsertCall = mocks.upsertNewsItems.mock.calls[0][0];
      expect(upsertCall).toHaveLength(1);
      expect(upsertCall[0].id).toBe('match-item');
    });

    test('should skip items with invalid growiVersionRegExps', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      mocks.getGrowiVersion.mockReturnValue('7.5.0');
      const feedWithInvalidRegex = {
        version: '1.0',
        items: [
          {
            id: 'invalid-regex-item',
            title: { ja_JP: '不正Regex' },
            publishedAt: '2026-01-01T00:00:00Z',
            conditions: { growiVersionRegExps: ['[invalid'] },
          },
          {
            id: 'valid-item',
            title: { ja_JP: '正常アイテム' },
            publishedAt: '2026-01-01T00:00:00Z',
          },
        ],
      };
      mocks.mockFetch.mockResolvedValue(mockResponse(feedWithInvalidRegex));

      await service.executeJob();

      const upsertCall = mocks.upsertNewsItems.mock.calls[0][0];
      // invalid-regex-item is skipped (treated as not matching), valid-item passes
      expect(upsertCall.map((i: { id: string }) => i.id)).toContain(
        'valid-item',
      );
      expect(upsertCall.map((i: { id: string }) => i.id)).not.toContain(
        'invalid-regex-item',
      );
    });

    test('should skip when response body exceeds size limit (5 MiB)', async () => {
      process.env.NEWS_FEED_URL = 'https://example.com/feed.json';
      // Build a string that exceeds 5 MiB
      const oversizedText = 'x'.repeat(5 * 1024 * 1024 + 1);
      mocks.mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(oversizedText),
      });

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
      expect(mocks.deleteNewsItemsByExternalIds).not.toHaveBeenCalled();
    });
  });
});
