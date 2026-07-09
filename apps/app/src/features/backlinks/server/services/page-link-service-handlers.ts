import { getIdForRef, isPopulated } from '@growi/core';

import type { PageDocument } from '~/server/models/page';
import { Revision } from '~/server/models/revision';

import { extractInternalLinks } from './extract-internal-links';
import { syncOutboundLinks } from './page-link-sync';
import { resolveToPage } from './target-page-resolution';

export const handlePageUpsert = async (
  page: PageDocument,
  siteUrl?: string,
) => {
  const getRevisionBody = async (
    page: PageDocument,
  ): Promise<string | null> => {
    if (page.revision != null) {
      const rev = await Revision.findById(getIdForRef(page.revision))
        .select('body')
        .lean();
      return rev?.body ?? null;
    }

    return null;
  };

  const fromPage = page._id;
  if (fromPage == null) return;

  const revision =
    page.revision != null && isPopulated(page.revision) ? page.revision : null;
  const body = revision?.body ?? (await getRevisionBody(page)) ?? '';
  const paths = await extractInternalLinks(body, page.path, siteUrl);

  const rows = await Promise.all(
    paths.map(async (toPath) => ({
      fromPage,
      toPath,
      toPage: await resolveToPage(toPath),
    })),
  );

  await syncOutboundLinks(fromPage, rows);
};
