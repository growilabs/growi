import { pagePathUtils } from '@growi/core/dist/utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import type { Nodes } from 'hast';

const RELATIVE_BASE = new URL('https://relative.invalid');

const isAnchorLink = (href: string): boolean => {
  return href.length > 0 && href[0] === '#';
};

/**
 * Load the markdown->hast stack.
 *
 * WHY dynamic import(): this module is statically reachable from the server's
 * boot graph (crowi -> PageLinkService -> handlers -> here), and the unified /
 * remark / rehype stack adds ~16 MiB RSS on top of what the rest of the boot
 * graph already loads (31 MiB measured in isolation, but ~15 MiB of that is
 * shared with mongoose / the page model and paid regardless). Imported at top
 * level, every deployment would pay that at startup forever — including
 * processes that never save a page (`server:ci` boot check, read-only
 * instances). Extraction runs only on the backlinks drain timer, off the request
 * path, so the ~80 ms first load costs no user-visible latency; Node caches
 * modules, so later extractions resolve from the registry (~0.04 ms each).
 *
 * The local plugins are dynamic for the same reason — `relative-links` and
 * `relative-links-by-pukiwiki-like-linker` each reach `hast-util-select`
 * independently, so a static import of either keeps part of the stack eager.
 *
 * Guarded by `no-eager-markdown-imports.spec.ts`; see
 * `.claude/rules/server-boot-imports.md`.
 */
const importMarkdownStack = async () => {
  const [
    { unified },
    { default: remarkParse },
    { default: gfm },
    { default: remarkRehype },
    { default: rehypeRaw },
    { selectAll },
    { relativeLinks },
    { relativeLinksByPukiwikiLikeLinker },
    { pukiwikiLikeLinker },
  ] = await Promise.all([
    import('unified'),
    import('remark-parse'),
    import('remark-gfm'),
    import('remark-rehype'),
    import('rehype-raw'),
    import('hast-util-select'),
    import('~/services/renderer/rehype-plugins/relative-links'),
    import(
      '~/services/renderer/rehype-plugins/relative-links-by-pukiwiki-like-linker'
    ),
    import('~/services/renderer/remark-plugins/pukiwiki-like-linker'),
  ]);

  return {
    unified,
    remarkParse,
    gfm,
    remarkRehype,
    rehypeRaw,
    selectAll,
    relativeLinks,
    relativeLinksByPukiwikiLikeLinker,
    pukiwikiLikeLinker,
  };
};

let markdownStack: ReturnType<typeof importMarkdownStack> | null = null;

/**
 * Memoized so the nine `import()`s and their `Promise.all` run once per process rather than once
 * per extraction. Node caches the modules either way, so this saves the await plumbing, not the
 * parse — hence the promise is cached, not awaited here.
 */
const loadMarkdownStack = (): ReturnType<typeof importMarkdownStack> => {
  if (markdownStack == null) {
    markdownStack = importMarkdownStack().catch((err) => {
      // A rejected promise must not be cached, or one transient load failure would disable
      // extraction for the lifetime of the process.
      markdownStack = null;
      throw err;
    });
  }
  return markdownStack;
};

/**
 * Assemble a processor for one extraction.
 *
 * Built per call rather than memoized with the stack: both relative-link plugins are configured
 * with the page's own path, so a shared processor would resolve relative links against whichever
 * page happened to build it first.
 */
const buildPipeline = async (pagePath: string) => {
  const {
    unified,
    remarkParse,
    gfm,
    remarkRehype,
    rehypeRaw,
    selectAll,
    relativeLinks,
    relativeLinksByPukiwikiLikeLinker,
    pukiwikiLikeLinker,
  } = await loadMarkdownStack();

  const processor = unified()
    .use(remarkParse)
    .use(gfm)
    .use(pukiwikiLikeLinker)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(relativeLinksByPukiwikiLikeLinker, { pagePath })
    .use(relativeLinks, { pagePath });

  return { processor, selectAll };
};

/**
 * Extract internal page links from a page revision's markdown body.
 *
 * Resolves each link to a page path, dropping external, anchor, self, and
 * non-creatable links, and deduplicates the result.
 *
 * @returns Resolved internal page paths the body links to.
 */
export const extractInternalLinkPaths = async (
  markdown: string,
  pagePath: string,
  siteUrl?: string,
): Promise<string[]> => {
  const { processor, selectAll } = await buildPipeline(pagePath);

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
