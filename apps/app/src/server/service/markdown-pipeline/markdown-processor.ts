import type { Root as HastRoot } from 'hast';
import type * as HastUtilSanitize from 'hast-util-sanitize';

import { loadPlugins } from './esm-plugin-loader';
import { ADOPTED_PLUGINS } from './plugin-set';

/**
 * Build the sanitize schema by loading hast-util-sanitize and
 * services/renderer/recommended-whitelist.ts so that the server pipeline
 * shares a single source of truth with the web renderer.
 */
async function buildSanitizeOptions(): Promise<HastUtilSanitize.Schema> {
  const { defaultSchema }: typeof HastUtilSanitize = await import(
    'hast-util-sanitize'
  );

  const { tagNames, attributes } = await import(
    '~/services/renderer/recommended-whitelist'
  );

  return {
    ...defaultSchema,
    tagNames,
    attributes,
  };
}

/**
 * Build the unified processor by iterating the plugins declared in
 * plugin-set.ts (the single source of truth) in order. Nothing is wired by
 * hand here, so adding/removing/reordering a plugin is a one-file change in
 * plugin-set.ts.
 *
 * The one runtime-computed input is rehype-sanitize's schema
 * (buildSanitizeOptions), supplied here as that plugin's options.
 */
async function buildProcessor() {
  const { unified, plugins } = await loadPlugins(ADOPTED_PLUGINS);
  const sanitizeOptions = await buildSanitizeOptions();

  // unified().use() mutates the processor in place and returns `this`, so we
  // call it for its side effect on a single instance. (Reassigning would force
  // the variable's tree-type generics to change at each step.)
  const processor = unified();
  for (const { name, plugin, options } of plugins) {
    const resolvedOptions: unknown =
      name === 'rehype-sanitize' ? sanitizeOptions : options;
    if (resolvedOptions != null) {
      processor.use(plugin, resolvedOptions);
    } else {
      processor.use(plugin);
    }
  }
  return processor;
}

type MarkdownProcessor = Awaited<ReturnType<typeof buildProcessor>>;

/**
 * Built once on first use and reused; the plugins load via dynamic import(),
 * never at server boot. The in-flight build is shared so concurrent first
 * requests do not build twice, and a failed build is retried next time.
 */
let processorPromise: Promise<MarkdownProcessor> | undefined;

function getProcessor(): Promise<MarkdownProcessor> {
  if (processorPromise == null) {
    processorPromise = buildProcessor().catch((err: unknown) => {
      processorPromise = undefined;
      throw err;
    });
  }
  return processorPromise;
}

/** Convert a markdown body into a sanitized HTML fragment. */
export async function renderMarkdownToHtml(
  markdownBody: string,
): Promise<string> {
  const processor = await getProcessor();
  return String(await processor.process(markdownBody));
}

/**
 * Convert a markdown body into the final hast tree: every transformer runs
 * (sanitize, katex, add-class, ...), only the HTML serialization is skipped.
 * Nodes keep their `position` in `markdownBody` where the plugins preserve it.
 */
export async function renderMarkdownToHast(
  markdownBody: string,
): Promise<HastRoot> {
  const processor = await getProcessor();
  const tree = await processor.run(processor.parse(markdownBody));
  // WHY: the processor is assembled from data, so unified cannot infer that
  // its last transformer yields a hast root.
  return tree as HastRoot;
}
