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

const isAnchorLink = (href: string): boolean => {
  return href.toString().length > 0 && href[0] === '#';
};

const isExternalLink = (href: string, siteUrl?: string) => {
  try {
    const baseUrl = new URL(siteUrl ?? 'https://example.com');
    const hrefUrl = new URL(href, baseUrl);
    return baseUrl.host !== hrefUrl.host;
  } catch {
    return false;
  }
};

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
  const base = new URL(siteUrl ?? 'https://example.com');
  const normalizedSelf = normalizePath(pagePath);

  const linkSet = new Set<string>();

  for (const a of anchors) {
    const href = a.properties.href;

    if (
      typeof href !== 'string' ||
      isAnchorLink(href) ||
      isExternalLink(href, siteUrl)
    )
      continue;

    const path = normalizePath(new URL(href, base).pathname);

    if (!pagePathUtils.isCreatablePage(path) || path === normalizedSelf)
      continue;

    linkSet.add(path);
  }

  return Array.from(linkSet);
};
