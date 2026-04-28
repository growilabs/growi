import CronService from '~/server/service/cron';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import type { INewsItemInput } from '../../interfaces/news-item';
import { NewsService } from './news-service';

const logger = loggerFactory('growi:feature:news:cron');

/** Maximum random sleep in ms (5 hours) */
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 60 * 1000;

/** HTTP fetch timeout in ms */
const FETCH_TIMEOUT_MS = 10_000;

interface FeedItem {
  id: string;
  type?: string;
  emoji?: string;
  title: Record<string, string>;
  body?: Record<string, string>;
  url?: string;
  publishedAt: string;
  conditions?: {
    targetRoles?: string[];
    growiVersionRegExps?: string[];
  };
}

interface FeedJson {
  version: string;
  items: FeedItem[];
}

/**
 * Check if the given URL is allowed for fetching
 */
const isAllowedUrl = (url: string): boolean => {
  if (url.startsWith('https://')) return true;
  if (url.startsWith('http://localhost')) return true;
  if (url.startsWith('http://127.0.0.1')) return true;
  return false;
};

/**
 * Check if the item matches the current GROWI version
 * Returns true if no version conditions set.
 * If a regex is invalid, the item is skipped (returns false).
 */
const matchesGrowiVersion = (
  item: FeedItem,
  currentVersion: string,
): boolean => {
  const regExps = item.conditions?.growiVersionRegExps;
  if (!regExps || regExps.length === 0) return true;

  return regExps.some((pattern) => {
    try {
      return new RegExp(pattern).test(currentVersion);
    } catch {
      logger.warn(`Invalid growiVersionRegExp pattern skipped: ${pattern}`);
      return false;
    }
  });
};

/**
 * Sleep for a random duration between 0 and maxMs
 */
const randomSleep = (maxMs: number): Promise<void> => {
  const ms = Math.floor(Math.random() * maxMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export class NewsCronService extends CronService {
  override getCronSchedule(): string {
    return '0 0 * * *';
  }

  override async executeJob(): Promise<void> {
    const feedUrl = process.env.NEWS_FEED_URL;

    if (!feedUrl || feedUrl.trim() === '') {
      logger.debug('NEWS_FEED_URL is not set, skipping news feed sync');
      return;
    }

    if (!isAllowedUrl(feedUrl)) {
      logger.warn(
        `NEWS_FEED_URL "${feedUrl}" is not allowed. Only https:// and http://localhost or http://127.0.0.1 are permitted.`,
      );
      return;
    }

    // Random sleep to distribute requests across multiple GROWI instances
    await randomSleep(MAX_RANDOM_SLEEP_MS);

    let feedJson: FeedJson;
    try {
      const response = await fetch(feedUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.error(`Failed to fetch news feed: HTTP ${response.status}`);
        return;
      }

      feedJson = (await response.json()) as FeedJson;
    } catch (err) {
      logger.error('Error fetching news feed, keeping existing data', err);
      return;
    }

    const currentVersion = getGrowiVersion();
    const filteredItems = feedJson.items.filter((item) =>
      matchesGrowiVersion(item, currentVersion),
    );

    // Convert FeedItem to INewsItemInput (reuse id as externalId)
    const newsItemInputs: INewsItemInput[] = filteredItems.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      emoji: item.emoji,
      url: item.url,
      publishedAt: item.publishedAt,
      conditions: item.conditions
        ? {
            targetRoles: item.conditions.targetRoles,
          }
        : undefined,
    }));

    const feedIds = new Set(filteredItems.map((item) => item.id));

    // Get all existing external IDs to find which ones are no longer in the feed
    // We pass all filtered items' IDs — items not in the feed are determined by exclusion
    const allFeedIds = feedJson.items.map((item) => item.id);
    const idsToDelete = allFeedIds.filter((id) => !feedIds.has(id));

    const service = new NewsService();
    await service.upsertNewsItems(newsItemInputs);
    await service.deleteNewsItemsByExternalIds(idsToDelete);
  }
}
