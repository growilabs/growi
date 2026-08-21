import { pagePathUtils } from '@growi/core/dist/utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import type { Nodes } from 'hast';
import { selectAll } from 'hast-util-select';
import rehypeRaw from 'rehype-raw';
import gfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { relativeLinks } from '~/services/renderer/rehype-plugins/relative-links';
import { relativeLinksByPukiwikiLikeLinker } from '~/services/renderer/rehype-plugins/relative-links-by-pukiwiki-like-linker';
import { pukiwikiLikeLinker } from '~/services/renderer/remark-plugins/pukiwiki-like-linker';

const RELATIVE_BASE = new URL('https://relative.invalid');

const isAnchorLink = (href: string): boolean => {
  return href.length > 0 && href[0] === '#';
};

/**
 * Extract internal page links from a page revision's markdown body.
 *
 * Resolves each link to a page path, dropping external, anchor, self, and
 * non-creatable links, and deduplicates the result.
 *
 * @returns Resolved internal page paths the body links to.
 */
export const extractInternalLinks = async (
  markdown: string,
  pagePath: string,
  siteUrl?: string,
): Promise<string[]> => {
  const processor = unified()
    .use(remarkParse)
    .use(gfm)
    .use(pukiwikiLikeLinker)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(relativeLinksByPukiwikiLikeLinker, { pagePath })
    .use(relativeLinks, { pagePath });

  const hastTree = processor.parse(markdown);
  const runTree = await processor.run(hastTree);

  const anchors = selectAll('a[href]', runTree as Nodes);

  let siteHost: string | null = null;
  if (siteUrl != null) {
    try {
      siteHost = new URL(siteUrl).host;
    } catch {
      siteHost = null;
    }
  }

  const normalizedSelf = normalizePath(pagePath);
  const linkSet = new Set<string>();

  for (const a of anchors) {
    const href = a.properties.href;

    if (typeof href !== 'string' || isAnchorLink(href)) continue;

    let url: URL;
    try {
      url = new URL(href, RELATIVE_BASE);
    } catch {
      continue;
    }

    // Relative hrefs resolve to RELATIVE_BASE's host (internal by construction);
    // absolute hrefs are internal only when their host matches the site host.
    const isRelative = url.host === RELATIVE_BASE.host;
    const isInternalAbsolute = siteHost != null && url.host === siteHost;
    if (!isRelative && !isInternalAbsolute) continue;

    // Skip links with malformed path.
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      continue;
    }
    const path = normalizePath(decodedPath);

    if (!pagePathUtils.isCreatablePage(path) || path === normalizedSelf)
      continue;

    linkSet.add(path);
  }

  return Array.from(linkSet);
};
