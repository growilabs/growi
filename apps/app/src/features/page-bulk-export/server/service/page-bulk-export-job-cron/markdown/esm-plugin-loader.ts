import path from 'node:path';
import { dynamicImport } from '@cspell/dynamic-import';
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
  /** Canonical name from the declaration (npm specifier or local short name). */
  readonly name: string;
  /** The resolved plugin export, ready to hand to `processor.use(...)`. */
  readonly plugin: AnyPlugin;
  /** Static options declared in plugin-set.ts (undefined = call with no options). */
  readonly options?: Record<string, unknown>;
}

/**
 * The `unified` factory plus the ordered, loaded plugin list.
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
 * Load `unified` and every declared plugin via dynamicImport (the only way to
 * consume ESM from the CJS server runtime).
 *
 * This loader's single responsibility is *loading*: the caller decides *what* to
 * load and passes the declarations in (the canonical set lives in plugin-set.ts).
 * It holds no cache — callers that need build-once semantics cache the assembled
 * processor (see BulkExportMarkdownRenderer).
 *
 * Each declaration is resolved as:
 *  - `specifier ?? name` — bare npm specifier, or a relative path (resolved
 *    against `baseDir`) for a reused local GROWI plugin.
 *  - `exportName ?? 'default'` — which export to use as the plugin.
 *
 * @param baseDir - Resolution base for `dynamicImport` (caller's `__dirname`).
 * @param declarations - Ordered plugin declarations to load.
 */
export async function loadPlugins(
  baseDir: string,
  declarations: readonly PluginDeclaration[],
): Promise<LoadedPipeline> {
  const unifiedModule = await dynamicImport<typeof Unified>('unified', baseDir);

  const plugins = await Promise.all(
    declarations.map(async (declaration): Promise<LoadedPlugin> => {
      const specifier = declaration.specifier ?? declaration.name;
      // Relative specifiers point to reused local GROWI plugins; resolve them
      // against baseDir. Bare specifiers are npm packages dynamicImport resolves.
      const target = specifier.startsWith('.')
        ? path.resolve(baseDir, specifier)
        : specifier;
      const exportName = declaration.exportName ?? 'default';

      const module = await dynamicImport<Record<string, AnyPlugin>>(
        target,
        baseDir,
      );
      const plugin = module[exportName];
      if (plugin == null) {
        throw new Error(
          `[EsmPluginLoader] "${specifier}" has no export "${exportName}" ` +
            `(declared for plugin "${declaration.name}" in plugin-set.ts).`,
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
