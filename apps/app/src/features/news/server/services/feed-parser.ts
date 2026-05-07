import { z } from 'zod';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:feature:news:feed-parser');

const FeedItemSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  emoji: z.string().optional(),
  title: z.record(z.string()),
  body: z.record(z.string()).optional(),
  url: z.string().optional(),
  publishedAt: z.string().min(1),
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
