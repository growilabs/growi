import { dynamicImport } from '@cspell/dynamic-import';
import type * as RehypeKatex from 'rehype-katex';
import type * as RehypeRaw from 'rehype-raw';
import type * as RehypeSanitize from 'rehype-sanitize';
import type * as RehypeSlug from 'rehype-slug';
import type * as RehypeStringify from 'rehype-stringify';
import type * as RemarkFrontmatter from 'remark-frontmatter';
import type * as RemarkGfm from 'remark-gfm';
import type * as RemarkMath from 'remark-math';
import type * as RemarkParse from 'remark-parse';
import type * as RemarkRehype from 'remark-rehype';
import type * as Unified from 'unified';

import { ADOPTED_PLUGIN_NAMES } from './plugin-set';

/**
 * Plugin names that this loader imports, in the same order as the dynamicImport calls below.
 * Must be a subset of ADOPTED_PLUGIN_NAMES (from plugin-set.ts, the single source of truth).
 * "unified" is the pipeline entry point and is not a remark/rehype plugin, so it is omitted
 * from ADOPTED_PLUGIN_NAMES but is still loaded here.
 *
 * This constant is used by the runtime assertion below to prevent the loader from silently
 * drifting out of sync with plugin-set.ts.
 */
const LOADER_PLUGIN_NAMES: ReadonlyArray<string> = [
  'remark-parse',
  'remark-gfm',
  'remark-frontmatter',
  'remark-math',
  'remark-rehype',
  'rehype-raw',
  'rehype-slug',
  'rehype-sanitize',
  'rehype-katex',
  'rehype-stringify',
];

// Compile-time-style assertion: every name this loader requests must exist in the
// canonical ADOPTED_PLUGIN_NAMES set declared by plugin-set.ts.  Violations surface
// immediately when loadPlugins() is first called rather than at deploy time.
for (const name of LOADER_PLUGIN_NAMES) {
  if (!ADOPTED_PLUGIN_NAMES.has(name)) {
    throw new Error(
      `[EsmPluginLoader] Plugin "${name}" is not listed in ADOPTED_PLUGIN_NAMES (plugin-set.ts). ` +
        'Update plugin-set.ts to add it, or remove the import from esm-plugin-loader.ts.',
    );
  }
}

/**
 * All unified/remark/rehype plugins required by the bulk-export Markdown→HTML pipeline,
 * loaded once via dynamicImport (the only way to consume ESM modules from a CJS runtime).
 *
 * Requirement 5.4: operates in the current server runtime without ESM migration.
 * Requirement 1.6: structural alignment with the GROWI web renderer plugin set.
 * Design: plugin-set.ts is the single source of truth; this loader consumes from it.
 */
export interface LoadedPlugins {
  readonly unified: typeof import('unified').unified;
  readonly remarkParse: import('unified').Plugin;
  readonly remarkGfm: import('unified').Plugin;
  readonly remarkFrontmatter: import('unified').Plugin;
  readonly remarkMath: import('unified').Plugin;
  readonly remarkRehype: import('unified').Plugin;
  readonly rehypeRaw: import('unified').Plugin;
  readonly rehypeSlug: import('unified').Plugin;
  readonly rehypeSanitize: import('unified').Plugin;
  readonly rehypeKatex: import('unified').Plugin;
  readonly rehypeStringify: import('unified').Plugin;
}

/**
 * Module-level cache: plugins are dynamicImported once and reused across all pages
 * in a bulk-export job (mirrors the openai module-cache pattern in the codebase).
 */
let cachedPlugins: LoadedPlugins | undefined;

/**
 * Load all unified/remark/rehype ESM plugins needed by the bulk-export pipeline.
 *
 * On the first call, each plugin is fetched via `dynamicImport` (which uses CJS
 * `require()` under the hood for ESM interop) and the result is cached at module
 * level.  Subsequent calls return the cached object immediately.
 *
 * @param baseDir - Resolution base passed as the second argument to `dynamicImport`
 *                  (typically the caller's `__dirname`).
 */
export async function loadPlugins(baseDir: string): Promise<LoadedPlugins> {
  if (cachedPlugins != null) return cachedPlugins;

  const [
    unifiedModule,
    remarkParseModule,
    remarkGfmModule,
    remarkFrontmatterModule,
    remarkMathModule,
    remarkRehypeModule,
    rehypeRawModule,
    rehypeSlugModule,
    rehypeSanitizeModule,
    rehypeKatexModule,
    rehypeStringifyModule,
  ] = await Promise.all([
    dynamicImport<typeof Unified>('unified', baseDir),
    dynamicImport<typeof RemarkParse>('remark-parse', baseDir),
    dynamicImport<typeof RemarkGfm>('remark-gfm', baseDir),
    dynamicImport<typeof RemarkFrontmatter>('remark-frontmatter', baseDir),
    dynamicImport<typeof RemarkMath>('remark-math', baseDir),
    dynamicImport<typeof RemarkRehype>('remark-rehype', baseDir),
    dynamicImport<typeof RehypeRaw>('rehype-raw', baseDir),
    dynamicImport<typeof RehypeSlug>('rehype-slug', baseDir),
    dynamicImport<typeof RehypeSanitize>('rehype-sanitize', baseDir),
    dynamicImport<typeof RehypeKatex>('rehype-katex', baseDir),
    dynamicImport<typeof RehypeStringify>('rehype-stringify', baseDir),
  ]);

  cachedPlugins = {
    unified: unifiedModule.unified,
    remarkParse: remarkParseModule.default,
    remarkGfm: remarkGfmModule.default,
    remarkFrontmatter: remarkFrontmatterModule.default,
    remarkMath: remarkMathModule.default,
    remarkRehype: remarkRehypeModule.default,
    rehypeRaw: rehypeRawModule.default,
    rehypeSlug: rehypeSlugModule.default,
    rehypeSanitize: rehypeSanitizeModule.default,
    rehypeKatex: rehypeKatexModule.default,
    rehypeStringify: rehypeStringifyModule.default,
  };

  return cachedPlugins;
}
