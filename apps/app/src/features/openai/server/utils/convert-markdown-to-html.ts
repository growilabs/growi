import { dynamicImport } from '@cspell/dynamic-import';
import type { IPage } from '@growi/core/dist/interfaces';
import { DevidedPagePath } from '@growi/core/dist/models';
import type { Code, Root } from 'mdast';
import type * as RehypeMeta from 'rehype-meta';
import type * as RehypeStringify from 'rehype-stringify';
import type * as RemarkParse from 'remark-parse';
import type * as RemarkRehype from 'remark-rehype';
import type * as Unified from 'unified';
import type * as UnistUtilVisit from 'unist-util-visit';

interface ModuleCache {
  unified?: typeof Unified.unified;
  visit?: typeof UnistUtilVisit.visit;
  remarkParse?: typeof RemarkParse.default;
  remarkRehype?: typeof RemarkRehype.default;
  rehypeMeta?: typeof RehypeMeta.default;
  rehypeStringify?: typeof RehypeStringify.default;
}

let moduleCache: ModuleCache = {};

const initializeModules = async (): Promise<void> => {
  if (
    moduleCache.unified != null &&
    moduleCache.visit != null &&
    moduleCache.remarkParse != null &&
    moduleCache.remarkRehype != null &&
    moduleCache.rehypeMeta != null &&
    moduleCache.rehypeStringify != null
  ) {
    return;
  }

  const [
    { unified },
    { visit },
    { default: remarkParse },
    { default: remarkRehype },
    { default: rehypeMeta },
    { default: rehypeStringify },
  ] = await Promise.all([
    dynamicImport<typeof Unified>('unified', __dirname),
    dynamicImport<typeof UnistUtilVisit>('unist-util-visit', __dirname),
    dynamicImport<typeof RemarkParse>('remark-parse', __dirname),
    dynamicImport<typeof RemarkRehype>('remark-rehype', __dirname),
    dynamicImport<typeof RehypeMeta>('rehype-meta', __dirname),
    dynamicImport<typeof RehypeStringify>('rehype-stringify', __dirname),
  ]);

  moduleCache = {
    unified,
    visit,
    remarkParse,
    remarkRehype,
    rehypeMeta,
    rehypeStringify,
  };
};

type ConvertMarkdownToHtmlArgs = {
  page: IPage;
  siteUrl: string | undefined;
};

export const convertMarkdownToHtml = async (
  revisionBody: string,
  args: ConvertMarkdownToHtmlArgs,
): Promise<string> => {
  await initializeModules();

  const {
    unified,
    visit,
    remarkParse,
    remarkRehype,
    rehypeMeta,
    rehypeStringify,
  } = moduleCache;

  if (
    unified == null ||
    visit == null ||
    remarkParse == null ||
    remarkRehype == null ||
    rehypeMeta == null ||
    rehypeStringify == null
  ) {
    throw new Error('Failed to initialize required modules');
  }

  const sanitizeMarkdown = () => {
    return (tree: Root) => {
      visit(tree, 'code', (node: Code) => {
        if (node.lang === 'drawio') {
          node.value = '<!-- drawio content replaced -->';
        }
      });
    };
  };

  const { page, siteUrl } = args;
  const { latter: title } = new DevidedPagePath(page.path);

  const processor = unified()
    .use(remarkParse)
    .use(sanitizeMarkdown)
    .use(remarkRehype)
    .use(rehypeMeta, {
      og: true,
      type: 'article',
      title,
      pathname: page.path,
      published: page.createdAt,
      modified: page.updatedAt,
      origin: siteUrl,
    })
    .use(rehypeStringify);

  return processor.processSync(revisionBody).toString();
};
