import type { Types } from 'mongoose';

import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { BackfillLinkResolver } from './backfill-link-resolver';
import {
  BACKFILL_PAGE_RETRY_BACKOFF_MS,
  MAX_BACKFILL_PAGE_ATTEMPTS,
} from './backfill-pacing';
import { extractInternalLinkPaths } from './extract-internal-link-paths';
import { syncOutboundLinks } from './page-link-sync';

const logger = loggerFactory('growi:features:backlinks:backfill-page');

export interface BackfillPageRow {
  readonly _id: Types.ObjectId;
  readonly path: string;
  readonly revision?: Types.ObjectId | null;
}

export interface BackfillPageContext {
  readonly resolve: BackfillLinkResolver;
  readonly siteUrl: string | undefined;
  readonly maxBodyBytes: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface BackfillPageResult {
  /** `skipped`: over the body-size cap, or every attempt failed. Logged either way. */
  readonly outcome: 'indexed' | 'skipped';
  /** Time spent in attempts, excluding the backoffs between them: the pacing charge. */
  readonly workMs: number;
}

const readBody = async (
  revisionId: Types.ObjectId | null | undefined,
): Promise<string> => {
  if (revisionId == null) return '';
  const revision = await prisma.revisions.findUnique({
    where: { id: revisionId.toString() },
    select: { body: true },
  });
  return revision?.body ?? '';
};

const indexPage = async (
  page: BackfillPageRow,
  ctx: BackfillPageContext,
): Promise<BackfillPageResult['outcome']> => {
  const body = await readBody(page.revision);

  // Checked before parsing: a parse cannot be interrupted, so only this bounds the stall.
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > ctx.maxBodyBytes) {
    logger.warn(
      { pageId: page._id, bodyBytes, maxBodyBytes: ctx.maxBodyBytes },
      'backlinks backfill skipped a page whose body is over the size cap; its links are indexed on its next save',
    );
    return 'skipped';
  }

  const paths = await extractInternalLinkPaths(body, page.path, ctx.siteUrl);
  const rows = paths.map((toPath) => ({
    fromPage: page._id,
    toPath,
    toPage: ctx.resolve(toPath),
  }));
  await syncOutboundLinks(page._id, rows);
  return 'indexed';
};

/**
 * Index one page, retrying a failure in place up to `MAX_BACKFILL_PAGE_ATTEMPTS`, then skip it so
 * a page that keeps failing cannot stall the walk.
 */
export const backfillPage = async (
  page: BackfillPageRow,
  ctx: BackfillPageContext,
): Promise<BackfillPageResult> => {
  let workMs = 0;
  for (let attempt = 1; ; attempt++) {
    const startedAt = ctx.now();
    try {
      // biome-ignore lint/performance/noAwaitInLoops: attempts are sequential by definition
      const outcome = await indexPage(page, ctx);
      return { outcome, workMs: workMs + (ctx.now() - startedAt) };
    } catch (err) {
      workMs += ctx.now() - startedAt;
      logger.error(
        { err, pageId: page._id, attempt },
        'backlinks backfill failed on a page',
      );
      if (attempt >= MAX_BACKFILL_PAGE_ATTEMPTS) {
        logger.error(
          { pageId: page._id, attempts: attempt },
          'backlinks backfill giving up on this page; its links are indexed on its next save',
        );
        return { outcome: 'skipped', workMs };
      }
      await ctx.sleep(BACKFILL_PAGE_RETRY_BACKOFF_MS);
    }
  }
};
