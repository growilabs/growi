import { getIdForRef, isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import { extractInternalLinkPaths } from './extract-internal-link-paths';
import { syncOutboundLinks } from './page-link-sync';
import { resolveToPageIds } from './target-page-resolution';

const loadBody = async (page: PageDocument): Promise<string> => {
  const { revision } = page;
  if (revision == null) return '';
  if (isPopulated(revision)) return revision.body ?? '';
  const rev = await Revision.findById(getIdForRef(revision))
    .select('body')
    .lean();
  return rev?.body ?? '';
};

export const handlePageUpsert = async (
  page: PageDocument,
  siteUrl?: string,
): Promise<void> => {
  const fromPage = page._id;
  if (fromPage == null) return;

  const body = await loadBody(page);
  const paths = await extractInternalLinkPaths(body, page.path, siteUrl);

  const resolvedPageIds = await resolveToPageIds(paths);
  const rows = paths.map((toPath) => ({
    fromPage,
    toPath,
    toPage: resolvedPageIds.get(toPath) ?? null,
  }));

  await syncOutboundLinks(fromPage, rows);
};

/**
 * Drain-time entry point for the coalescing queue: load the page by id, then upsert its links.
 * The queue holds ids rather than the event's documents so the body is re-read here — coalesced
 * saves then collapse to one extraction over the latest state, with no ordering assumption about
 * which event payload arrived last.
 */
export const handlePageUpsertById = async (
  pageId: string,
  siteUrl?: string,
): Promise<void> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  const page = await Page.findById(pageId).select('_id path revision status');
  // Gone between the save and this drain: skip rather than re-create rows for a deleted source.
  if (page == null) return;
  // A soft delete only rewrites path and status, so the check above does not catch it and a stale
  // upsert would index a source now under /trash. Keyed on STATUS_DELETED rather than
  // STATUS_PUBLISHED because a legacy page's null status means published. Clearing the rows such a
  // page already owns is reconciliation (B5.2), not yet implemented.
  if (page.status === Page.STATUS_DELETED) return;

  await handlePageUpsert(page, siteUrl);
};
