import { performance } from 'node:perf_hooks';
import { getIdForRef } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import { extractInternalLinkPaths } from './extract-internal-link-paths';
import { reResolveByToPath, syncOutboundLinks } from './page-link-sync';
import { resolveToPageIds } from './target-page-resolution';

// The only caller reads the page with a projection and never populates, so the revision is always
// a ref here.
const loadBody = async (page: PageDocument): Promise<string> => {
  const { revision } = page;
  if (revision == null) return '';
  const rev = await prisma.revisions.findUnique({
    where: { id: getIdForRef(revision).toString() },
    select: { body: true },
  });
  return rev?.body ?? '';
};

/** @returns milliseconds spent in synchronous markdown extraction (the queue's pacing input). */
const handlePageUpsert = async (
  page: PageDocument,
  siteUrl?: string,
): Promise<number> => {
  const fromPage = page._id;
  if (fromPage == null) return 0;

  const body = await loadBody(page);

  // Timed narrowly: extraction is the only loop-blocking part here. The DB round-trips on either
  // side yield the loop, so charging the queue for them would rest it for time it never occupied.
  const extractionStartedAt = performance.now();
  const paths = await extractInternalLinkPaths(body, page.path, siteUrl);
  const extractionMs = performance.now() - extractionStartedAt;

  const resolvedPageIds = await resolveToPageIds(paths);
  const rows = paths.map((toPath) => ({
    fromPage,
    toPath,
    toPage: resolvedPageIds.get(toPath) ?? null,
  }));

  await syncOutboundLinks(fromPage, rows);
  await reResolveByToPath(page.path);

  return extractionMs;
};

/**
 * Drain-time entry point for the coalescing queue: load the page by id, then upsert its links.
 * The queue holds ids rather than the event's documents so the body is re-read here — coalesced
 * saves then collapse to one extraction over the latest state, with no ordering assumption about
 * which event payload arrived last.
 *
 * @returns milliseconds spent in synchronous markdown extraction; 0 when the page was skipped.
 */
export const handlePageUpsertById = async (
  pageId: string,
  siteUrl?: string,
): Promise<number> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  const page = await Page.findById(pageId).select('_id path revision status');
  // Gone between the save and this drain: skip rather than re-create rows for a deleted source.
  if (page == null) return 0;
  // A soft delete only rewrites path and status, so the check above does not catch it and a stale
  // upsert would index a source now under /trash. Keyed on STATUS_DELETED rather than
  // STATUS_PUBLISHED because a legacy page's null status means published. Clearing the rows such a
  // page already owns is reconciliation (B5.2), not yet implemented.
  if (page.status === Page.STATUS_DELETED) return 0;

  return handlePageUpsert(page, siteUrl);
};
