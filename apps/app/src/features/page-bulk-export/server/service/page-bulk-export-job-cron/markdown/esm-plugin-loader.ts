import { dynamicImport } from '@cspell/dynamic-import';
import type * as Unified from 'unified';

import { ADOPTED_PLUGINS } from './plugin-set';

/**
 * A unified plugin whose options (if any) are passed as a single argument.
 * The concrete options type is plugin-specific; the loader stays generic and
 * lets the pipeline assembler decide what to pass.
 */
type AnyPlugin = Unified.Plugin<[unknown?]>;

/**
 * A plugin loaded from its npm package, paired with the declaration metadata
 * (name + options) from plugin-set.ts so the pipeline can be assembled by
 * iterating this list in order — no per-plugin wiring required.
 */
export interface LoadedPlugin {
  /** Canonical npm package name (matches the entry in ADOPTED_PLUGINS). */
  readonly name: string;
  /** The plugin's default export, ready to hand to `processor.use(...)`. */
  readonly plugin: AnyPlugin;
  /** Static options declared in plugin-set.ts (undefined = call with no options). */
  readonly options?: Record<string, unknown>;
}

/**
 * Everything the bulk-export pipeline needs: the `unified` factory plus the
 * ordered, loaded plugin list. `plugin-set.ts` is the single source of truth —
 * this loader derives the import list from ADOPTED_PLUGINS, so adding a plugin
 * is a one-file change (plugin-set.ts) and never touches this file.
 *
 * Requirement 5.4: operates in the current CJS server runtime without ESM
 * migration (all modules read via dynamicImport).
 * Requirement 1.6: structural alignment with the GROWI web renderer plugin set.
 */
export interface LoadedPipeline {
  readonly unified: typeof Unified.unified;
  readonly plugins: readonly LoadedPlugin[];
}

/**
 * Module-level cache: modules are dynamicImported once and reused across all
 * pages in a bulk-export job (mirrors the openai module-cache pattern).
 */
let cachedPipeline: LoadedPipeline | undefined;

/**
 * Load `unified` and every plugin declared in ADOPTED_PLUGINS via dynamicImport
 * (the only way to consume ESM from the CJS server runtime). Plugins are loaded
 * in parallel on the first call and cached at module level; subsequent calls
 * return the cached object immediately.
 *
 * @param baseDir - Resolution base passed to `dynamicImport` (caller's `__dirname`).
 */
export async function loadPlugins(baseDir: string): Promise<LoadedPipeline> {
  if (cachedPipeline != null) return cachedPipeline;

  const unifiedModule = await dynamicImport<typeof Unified>('unified', baseDir);

  const plugins = await Promise.all(
    ADOPTED_PLUGINS.map(async (declaration): Promise<LoadedPlugin> => {
      const module = await dynamicImport<{ default: AnyPlugin }>(
        declaration.name,
        baseDir,
      );
      return {
        name: declaration.name,
        plugin: module.default,
        options: declaration.options,
      };
    }),
  );

  cachedPipeline = { unified: unifiedModule.unified, plugins };
  return cachedPipeline;
}
