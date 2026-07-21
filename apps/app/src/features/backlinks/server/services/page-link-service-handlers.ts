import { getIdForRef, isPopulated } from '@growi/core';

import type { PageDocument } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import { extractInternalLinks } from './extract-internal-links';
import { syncOutboundLinks } from './page-link-sync';
import { resolveToPages } from './target-page-resolution';

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
  const paths = await extractInternalLinks(body, page.path, siteUrl);

  const resolved = await resolveToPages(paths);
  const rows = paths.map((toPath) => ({
    fromPage,
    toPath,
    toPage: resolved.get(toPath) ?? null,
  }));

  await syncOutboundLinks(fromPage, rows);
};
