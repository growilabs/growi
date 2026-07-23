// Hoisted mocks
const mocks = vi.hoisted(() => {
  const upsertNewsItems = vi.fn();
  const deleteItemsNotInFeed = vi.fn();
  const mockFetch = vi.fn();
  const getGrowiVersion = vi.fn(() => '7.5.0');
  // Default delivery to enabled so existing tests behave as before.
  // Tests that need OFF state can override via mocks.getConfig.mockImplementationOnce.
  const getConfig = vi.fn<(key: string) => unknown>((key: string) => {
    if (key === 'news:isDeliveryEnabled') return true;
    return undefined;
  });

  return {
    NewsService: vi.fn(() => ({
      upsertNewsItems,
      deleteItemsNotInFeed,
    })),
    upsertNewsItems,
    deleteItemsNotInFeed,
    mockFetch,
    getGrowiVersion,
    getConfig,
  };
});

vi.mock('../services/news-service', () => ({
  NewsService: mocks.NewsService,
}));

vi.mock('~/utils/growi-version', () => ({
  getGrowiVersion: mocks.getGrowiVersion,
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: mocks.getConfig,
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', mocks.mockFetch);

// Mock Math.random for deterministic sleep (zero sleep)
vi.spyOn(Math, 'random').mockReturnValue(0);

// Spy mode: real implementation by default, overridable per test
vi.mock('./resolve-image-url', { spy: true });

import { NewsCronService } from './news-cron-service';
import { resolveNewsImageUrl } from './resolve-image-url';

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

  beforeEach(() => {
    service = new NewsCronService();
    vi.clearAllMocks();
    // Reset random mock
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  describe('getCronSchedule', () => {
    test('should return daily schedule at midnight', () => {
      expect(service.getCronSchedule()).toBe('0 0 * * *');
    });
  });

  describe('executeJob', () => {
    test('should skip when news:isDeliveryEnabled is false', async () => {
      mocks.getConfig.mockImplementationOnce((key: string) =>
        key === 'news:isDeliveryEnabled' ? false : undefined,
      );

      await service.executeJob();

      // Delivery flag short-circuits before any network call or DB write
      expect(mocks.mockFetch).not.toHaveBeenCalled();
      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
    });

    test('should run when news:isDeliveryEnabled is true (default)', async () => {
      mocks.mockFetch.mockResolvedValue(
        mockResponse({ version: '1.0', items: [] }),
      );

      await service.executeJob();

      expect(mocks.getConfig).toHaveBeenCalledWith('news:isDeliveryEnabled');
      expect(mocks.mockFetch).toHaveBeenCalled();
    });

    test('should fetch from the hardcoded vendor URL', async () => {
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.mockFetch).toHaveBeenCalledWith(
        'https://growilabs.github.io/growi-news-feed/feed.json',
        expect.any(Object),
      );
    });

    test('should upsert items on successful fetch', async () => {
      mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

      await service.executeJob();

      expect(mocks.upsertNewsItems).toHaveBeenCalledWith(VALID_FEED.items);
      expect(mocks.deleteItemsNotInFeed).toHaveBeenCalledWith([
        'item-001',
        'item-002',
      ]);
    });

    test('should NOT update DB when fetch fails', async () => {
      mocks.mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
      expect(mocks.deleteItemsNotInFeed).not.toHaveBeenCalled();
    });

    test('should NOT update DB when fetch throws', async () => {
      mocks.mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.executeJob()).resolves.not.toThrow();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
    });

    test('should filter items by growiVersionRegExps', async () => {
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

    // Regression for Requirement 1.3: items removed from the feed must be
    // deleted from the local DB. Earlier code computed `idsToDelete` from
    // `feedJson.items` only, so DB items absent from the feed were never
    // cleaned up. The cron must now hand the full set of feed externalIds
    // to `deleteItemsNotInFeed`, which uses a $nin filter to remove the rest.
    test('should pass every feed externalId to deleteItemsNotInFeed (regression for stale-item bug)', async () => {
      const feed = {
        version: '1.0',
        items: [
          {
            id: 'still-present-1',
            title: { ja_JP: 'still present 1' },
            publishedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'still-present-2',
            title: { ja_JP: 'still present 2' },
            publishedAt: '2026-01-02T00:00:00Z',
          },
          // Item present in feed but version-filtered out — must remain in
          // the deletion safelist so it is not wiped from the DB.
          {
            id: 'version-filtered',
            title: { ja_JP: 'version filtered' },
            publishedAt: '2026-01-03T00:00:00Z',
            conditions: { growiVersionRegExps: ['^999\\.'] },
          },
        ],
      };
      mocks.mockFetch.mockResolvedValue(mockResponse(feed));

      await service.executeJob();

      // The argument is the *full* feed externalId list, not the
      // version-matched subset. Items absent from this list (e.g. an
      // earlier `removed-from-feed` item still in the DB) will be
      // deleted by the service via `$nin`.
      expect(mocks.deleteItemsNotInFeed).toHaveBeenCalledWith([
        'still-present-1',
        'still-present-2',
        'version-filtered',
      ]);
    });

    test('should skip when response body exceeds size limit (5 MiB)', async () => {
      // Build a string that exceeds 5 MiB
      const oversizedText = 'x'.repeat(5 * 1024 * 1024 + 1);
      mocks.mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(oversizedText),
      });

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
      expect(mocks.deleteItemsNotInFeed).not.toHaveBeenCalled();
    });

    test('should abort when top-level shape is invalid', async () => {
      // Missing `items` field — top-level schema check fails
      mocks.mockFetch.mockResolvedValue(mockResponse({ version: '1.0' }));

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
      expect(mocks.deleteItemsNotInFeed).not.toHaveBeenCalled();
    });

    test('should skip individual invalid items but keep valid ones', async () => {
      const feedWithMixedItems = {
        version: '1.0',
        items: [
          // Missing required fields (title, publishedAt) → skipped
          { id: 'broken-item' },
          // Valid item
          {
            id: 'good-item',
            title: { ja_JP: '正常' },
            publishedAt: '2026-01-01T00:00:00Z',
          },
        ],
      };
      mocks.mockFetch.mockResolvedValue(mockResponse(feedWithMixedItems));

      await service.executeJob();

      const upsertCall = mocks.upsertNewsItems.mock.calls[0][0];
      expect(upsertCall.map((i: { id: string }) => i.id)).toEqual([
        'good-item',
      ]);
    });

    test('should skip when response body is not valid JSON', async () => {
      mocks.mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not-a-json{'),
      });

      await service.executeJob();

      expect(mocks.upsertNewsItems).not.toHaveBeenCalled();
    });

    describe('image ingestion', () => {
      test('should resolve a valid image path into an absolute URL', async () => {
        const feed = {
          version: '1.0',
          items: [
            {
              id: 'with-image',
              title: { ja_JP: '画像つき' },
              publishedAt: '2026-01-01T00:00:00Z',
              image: {
                path: 'images/release.png',
                alt: { ja_JP: 'リリース画像' },
              },
            },
          ],
        };
        mocks.mockFetch.mockResolvedValue(mockResponse(feed));

        await service.executeJob();

        const [inputs] = mocks.upsertNewsItems.mock.calls[0];
        expect(inputs[0].image).toEqual({
          url: 'https://growilabs.github.io/growi-news-feed/images/release.png',
          alt: { ja_JP: 'リリース画像' },
        });
      });

      test('should ingest the item without image when containment validation rejects it', async () => {
        // Any path that passes the zod grammar also resolves safely, so the
        // resolve-layer rejection branch is reachable only when the two layers
        // disagree (defense-in-depth) — force that with a spy returning null.
        vi.mocked(resolveNewsImageUrl).mockReturnValueOnce(null);
        const feed = {
          version: '1.0',
          items: [
            {
              id: 'rejected-image',
              title: { ja_JP: '不正画像' },
              publishedAt: '2026-01-01T00:00:00Z',
              image: { path: 'images/valid-looking.png' },
            },
          ],
        };
        mocks.mockFetch.mockResolvedValue(mockResponse(feed));

        await service.executeJob();

        const [inputs] = mocks.upsertNewsItems.mock.calls[0];
        expect(inputs).toHaveLength(1);
        expect(inputs[0].id).toBe('rejected-image');
        expect(inputs[0].image).toBeUndefined();
      });

      test('should leave image undefined for items without one', async () => {
        mocks.mockFetch.mockResolvedValue(mockResponse(VALID_FEED));

        await service.executeJob();

        const [inputs] = mocks.upsertNewsItems.mock.calls[0];
        for (const input of inputs) {
          expect(input.image).toBeUndefined();
        }
      });
    });
  });
});
