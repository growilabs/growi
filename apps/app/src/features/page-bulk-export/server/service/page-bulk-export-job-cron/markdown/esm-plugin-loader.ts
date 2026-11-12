import type * as Unified from 'unified';

import type { PluginDeclaration } from './plugin-set';

/**
 * A unified plugin whose options (if any) are passed as a single argument.
 * The concrete options type is plugin-specific; the loader stays generic and
 * lets the pipeline assembler decide what to pass.
 */
type AnyPlugin = Unified.Plugin<[unknown?]>;

/**
 * A loaded plugin paired with the declaration metadata (name + options) so the
 * pipeline can be assembled by iterating this list in order — no per-plugin
 * wiring required.
 */
export interface LoadedPlugin {
  /** Canonical name from the declaration (npm package name or local short name). */
  readonly name: string;
  /** The resolved plugin export, ready to hand to `processor.use(...)`. */
  readonly plugin: AnyPlugin;
  /** Static options declared in plugin-set.ts (undefined = call with no options). */
  readonly options?: Record<string, unknown>;
}

/**
 * The `unified` factory plus the ordered, loaded plugin list.
 *
 * Requirement 1.6: structural alignment with the GROWI web renderer plugin set.
 */
export interface LoadedPipeline {
  readonly unified: typeof Unified.unified;
  readonly plugins: readonly LoadedPlugin[];
}

/**
 * Load `unified` and every declared plugin.
 *
 * This loader's single responsibility is *loading*: the caller decides *what* to
 * load and passes the declarations in (the canonical set lives in plugin-set.ts).
 * It holds no cache — callers that need build-once semantics cache the assembled
 * processor (see BulkExportMarkdownRenderer).
 *
 * Each declaration is resolved as:
 *  - `load ?? (() => import(name))` — an explicit dynamic-import thunk for a
 *    reused local GROWI plugin, or a bare npm package import by `name`.
 *  - `exportName ?? 'default'` — which export to use as the plugin.
 *
 * A `load` thunk must use a real `import()` (never a runtime-built string path):
 * only a literal specifier is rewritten to the correct emitted extension by
 * `bin/add-js-extensions.ts` and checked by `bin/verify-dist-resolution.ts` in
 * the production build (see `.claude/rules/import-convention.md`).
 *
 * @param declarations - Ordered plugin declarations to load.
 */
export async function loadPlugins(
  declarations: readonly PluginDeclaration[],
): Promise<LoadedPipeline> {
  const unifiedModule = await import('unified');

  const plugins = await Promise.all(
    declarations.map(async (declaration): Promise<LoadedPlugin> => {
      const load = declaration.load ?? (() => import(declaration.name));
      const exportName = declaration.exportName ?? 'default';

      const module: Record<string, AnyPlugin> = await load();
      const plugin = module[exportName];
      if (plugin == null) {
        throw new Error(
          `[EsmPluginLoader] "${declaration.name}" has no export "${exportName}" ` +
            `(declared in plugin-set.ts).`,
        );
      }

      return {
        name: declaration.name,
        plugin,
        options: declaration.options,
      };
    }),
  );

  return { unified: unifiedModule.unified, plugins };
}
