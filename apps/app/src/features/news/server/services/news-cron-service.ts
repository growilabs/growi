import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import type { INewsItemInput } from '../../interfaces/news-item';
import { type FeedItem, parseFeedJson } from './feed-parser';
import { NewsService } from './news-service';
import { resolveNewsImageUrl } from './resolve-image-url';

const logger = loggerFactory('growi:feature:news:cron');

/** Maximum random sleep in ms (5 hours) */
const MAX_RANDOM_SLEEP_MS = 5 * 60 * 60 * 1000;

/** HTTP fetch timeout in ms */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Maximum response body size (5 MiB).
 * Sanity limit for the trust boundary at the news feed adapter — caps how much
 * an external endpoint (broken or compromised) can push into our process memory.
 */
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Vendor-controlled news feed URL. Hardcoded so a fresh deployment delivers
 * news without any infrastructure-side env injection. Users (incl. admins)
 * cannot change this; opt-out is performed via the `news:isDeliveryEnabled`
 * config flag managed in the admin UI.
 */
const FEED_URL = 'https://growilabs.github.io/growi-news-feed/feed.json';

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
    // Read the delivery toggle (DB > defaultValue: true) on every tick so
    // an admin's UI change takes effect from the next scheduled run, with no
    // pod restart required (Requirements 9.5, 9.6).
    if (!configManager.getConfig('news:isDeliveryEnabled')) {
      logger.debug('News delivery is disabled, skipping news feed sync');
      return;
    }

    // Random sleep to distribute requests across multiple GROWI instances
    await randomSleep(MAX_RANDOM_SLEEP_MS);

    let rawJson: unknown;
    try {
      const response = await fetch(FEED_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.error(`Failed to fetch news feed: HTTP ${response.status}`);
        return;
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_SIZE_BYTES) {
        logger.error(
          `News feed response exceeds size limit (${MAX_RESPONSE_SIZE_BYTES} bytes), skipping`,
        );
        return;
      }

      rawJson = JSON.parse(text);
    } catch (err) {
      logger.error('Error fetching news feed, keeping existing data', err);
      return;
    }

    const feedJson = parseFeedJson(rawJson);
    if (feedJson == null) {
      return;
    }

    const currentVersion = getGrowiVersion();
    const filteredItems = feedJson.items.filter((item) =>
      matchesGrowiVersion(item, currentVersion),
    );

    // Convert FeedItem to INewsItemInput (reuse id as externalId)
    const newsItemInputs: INewsItemInput[] = filteredItems.map((item) => {
      // Resolve the feed-relative image path into an absolute URL, enforcing
      // https + containment inside the feed's images/ directory. A rejected
      // image never blocks the item itself (Requirement 1.4 fail-soft).
      const imageUrl =
        item.image != null
          ? resolveNewsImageUrl(item.image.path, FEED_URL)
          : null;
      if (item.image != null && imageUrl == null) {
        logger.warn(
          `News image rejected by containment validation, ingesting item without image: ${item.image.path} (item: ${item.id})`,
        );
      }

      return {
        id: item.id,
        title: item.title,
        body: item.body,
        emoji: item.emoji,
        url: item.url,
        image:
          imageUrl != null
            ? { url: imageUrl, alt: item.image?.alt }
            : undefined,
        publishedAt: item.publishedAt,
        conditions: item.conditions
          ? {
              targetRoles: item.conditions.targetRoles,
            }
          : undefined,
      };
    });

    // Pass the full set of feed externalIds so the service can delete any DB
    // item that is no longer present in the feed (Requirement 1.3). Includes
    // items filtered out by version match — those remain "in the feed" and
    // are allowed to age out via the NewsItem TTL.
    const feedExternalIds = feedJson.items.map((item) => item.id);

    const service = new NewsService();
    await service.upsertNewsItems(newsItemInputs);
    await service.deleteItemsNotInFeed(feedExternalIds);
  }
}
