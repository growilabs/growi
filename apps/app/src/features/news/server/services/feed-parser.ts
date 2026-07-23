import { z } from 'zod';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:feature:news:feed-parser');

// Allow only http(s) URLs to block javascript:/data:/vbscript: vectors (XSS).
// Items with disallowed schemes fail per-item validation and are dropped at parse time.
const HTTP_URL_PATTERN = /^https?:\/\//i;

/**
 * Image path grammar: fixed "images/" prefix, then a single filename of
 * [A-Za-z0-9._-] with an allowed raster extension. This syntactically rules
 * out traversal (`..` needs a `/` or a leading dot chain), percent-encoding,
 * query/hash, backslashes, absolute and protocol-relative URLs. SVG is
 * deliberately excluded (unneeded attack surface for vendor images).
 * Directory containment of the RESOLVED URL is enforced separately at ingest
 * (see resolve-image-url.ts) — this pattern is the grammar layer only.
 */
const IMAGE_PATH_PATTERN =
  /^images\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/;

const IMAGE_PATH_MAX_LENGTH = 200;
const IMAGE_ALT_MAX_LENGTH = 500;

const FeedItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  emoji: z.string().optional(),
  title: z.record(z.string()),
  body: z.record(z.string()).optional(),
  url: z.string().regex(HTTP_URL_PATTERN).optional(),
  publishedAt: z.string().min(1),
  // Field-level fail-soft: an invalid image must not reject the whole item
  // (the news itself is still valuable without its picture), so `.catch`
  // drops just this field with a warn log instead of failing the item.
  image: z
    .object({
      path: z.string().max(IMAGE_PATH_MAX_LENGTH).regex(IMAGE_PATH_PATTERN),
      alt: z.record(z.string().max(IMAGE_ALT_MAX_LENGTH)).optional(),
    })
    .optional()
    .catch((ctx) => {
      logger.warn(
        { issues: ctx.error.issues },
        'News feed item image failed validation, ingesting item without image',
      );
      return undefined;
    }),
  conditions: z
    .object({
      targetRoles: z.array(z.string()).optional(),
      growiVersionRegExps: z.array(z.string()).optional(),
    })
    .optional(),
});

const FeedJsonSchema = z.object({
  version: z.string(),
  // Items are parsed individually so a single bad item does not abort the batch
  items: z.array(z.unknown()),
});

export type FeedItem = z.infer<typeof FeedItemSchema>;

export interface FeedJson {
  version: string;
  items: FeedItem[];
}

/**
 * Validate parsed JSON against the feed schema.
 * Items failing per-item validation are skipped (logged), allowing the rest to be processed.
 * Returns null when the top-level shape is invalid.
 */
export const parseFeedJson = (raw: unknown): FeedJson | null => {
  const topResult = FeedJsonSchema.safeParse(raw);
  if (!topResult.success) {
    logger.error(
      { issues: topResult.error.issues },
      'News feed JSON top-level shape invalid',
    );
    return null;
  }

  const validItems: FeedItem[] = [];
  for (const rawItem of topResult.data.items) {
    const itemResult = FeedItemSchema.safeParse(rawItem);
    if (itemResult.success) {
      validItems.push(itemResult.data);
    } else {
      logger.warn(
        { issues: itemResult.error.issues },
        'News feed item failed validation, skipping',
      );
    }
  }

  return { version: topResult.data.version, items: validItems };
};
