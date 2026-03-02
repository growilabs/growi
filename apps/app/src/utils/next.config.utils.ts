// workaround by https://github.com/martpie/next-transpile-modules/issues/143#issuecomment-817467144

import fs from 'node:fs';
import path from 'node:path';

const nodeModulesPaths = [
  path.resolve(__dirname, '../../node_modules'),
  path.resolve(__dirname, '../../../../node_modules'),
];

interface Opts {
  ignorePackageNames: string[];
}

const defaultOpts: Opts = { ignorePackageNames: [] };

export const listScopedPackages = (
  scopes: string[],
  opts: Opts = defaultOpts,
): string[] => {
  const scopedPackages: string[] = [];

  nodeModulesPaths.forEach((nodeModulesPath) => {
    fs.readdirSync(nodeModulesPath)
      .filter((name) => scopes.includes(name))
      .forEach((scope) => {
        fs.readdirSync(path.resolve(nodeModulesPath, scope))
          .filter((name) => !name.startsWith('.'))
          .forEach((folderName) => {
            const packageJsonPath = path.resolve(
              nodeModulesPath,
              scope,
              folderName,
              'package.json',
            );
            if (fs.existsSync(packageJsonPath)) {
              const { name } = JSON.parse(
                fs.readFileSync(packageJsonPath, 'utf-8'),
              ) as { name: string };
              if (!opts.ignorePackageNames.includes(name)) {
                scopedPackages.push(name);
              }
            }
          });
      });
  });

  return scopedPackages;
};

type WebpackCompiler = {
  outputPath: string;
  hooks: {
    done: {
      tap(name: string, callback: (stats: any) => void): void;
    };
  };
};

/**
 * Webpack plugin that logs eager (initial) vs lazy (async-only) module counts.
 * Attach to client-side dev builds only.
 */
export const createChunkModuleStatsPlugin = () => ({
  apply(compiler: WebpackCompiler) {
    compiler.hooks.done.tap('ChunkModuleStatsPlugin', (stats) => {
      const { compilation } = stats;
      const initialModuleIds = new Set<string>();
      const asyncModuleIds = new Set<string>();

      for (const chunk of compilation.chunks) {
        const target = chunk.canBeInitial() ? initialModuleIds : asyncModuleIds;
        for (const module of compilation.chunkGraph.getChunkModulesIterable(
          chunk,
        )) {
          target.add(module.identifier());
        }
      }

      // Modules that appear ONLY in async chunks
      const asyncOnlyCount = [...asyncModuleIds].filter(
        (id) => !initialModuleIds.has(id),
      ).length;

      // biome-ignore lint/suspicious/noConsole: Dev-only module stats for compilation analysis
      console.log(
        `[ChunkModuleStats] initial: ${initialModuleIds.size}, async-only: ${asyncOnlyCount}, total: ${compilation.modules.size}`,
      );

      // Dump module details to file for analysis (only for large compilations)
      if (
        initialModuleIds.size > 500 &&
        process.env.DUMP_INITIAL_MODULES === '1'
      ) {
        const asyncOnlyIds = [...asyncModuleIds].filter(
          (id) => !initialModuleIds.has(id),
        );

        const analyzeModuleSet = (
          moduleIds: Set<string> | string[],
          title: string,
          filename: string,
        ): void => {
          const packageCounts: Record<string, number> = {};
          const appModules: string[] = [];
          for (const rawId of moduleIds) {
            // Strip webpack loader prefixes (e.g., "source-map-loader!/path/to/file" → "/path/to/file")
            const id = rawId.includes('!')
              ? rawId.slice(rawId.lastIndexOf('!') + 1)
              : rawId;
            const nmIdx = id.lastIndexOf('node_modules/');
            if (nmIdx !== -1) {
              const rest = id.slice(nmIdx + 'node_modules/'.length);
              const pkg = rest.startsWith('@')
                ? rest.split('/').slice(0, 2).join('/')
                : rest.split('/')[0];
              packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
            } else {
              appModules.push(id);
            }
          }
          const sorted = Object.entries(packageCounts).sort(
            (a, b) => b[1] - a[1],
          );
          const lines = [`# ${title}`, ''];
          const totalCount = Array.isArray(moduleIds)
            ? moduleIds.length
            : moduleIds.size;
          lines.push(`Total modules: ${totalCount}`);
          lines.push(`App modules (non-node_modules): ${appModules.length}`);
          lines.push(`node_modules packages: ${sorted.length}`);
          lines.push('');
          lines.push('## Top Packages by Module Count');
          lines.push('| # | Package | Modules |');
          lines.push('|---|---------|---------|');
          for (let i = 0; i < sorted.length; i++) {
            const [pkg, count] = sorted[i];
            lines.push(`| ${i + 1} | ${pkg} | ${count} |`);
          }
          lines.push('');
          lines.push('## App Modules (first 200)');
          for (const m of appModules.slice(0, 200)) {
            lines.push(`- ${m}`);
          }
          const outPath = path.resolve(compiler.outputPath, '..', filename);
          fs.writeFileSync(outPath, lines.join('\n'));
          // biome-ignore lint/suspicious/noConsole: Dev-only module stats dump path
          console.log(
            `[ChunkModuleStats] Dumped ${title.toLowerCase()} to ${outPath}`,
          );
        };

        analyzeModuleSet(
          initialModuleIds,
          'Initial Chunk Module Analysis',
          'initial-modules-analysis.md',
        );
        analyzeModuleSet(
          asyncOnlyIds,
          'Async-Only Chunk Module Analysis',
          'async-modules-analysis.md',
        );
      }
    });
  },
});

export const listPrefixedPackages = (
  prefixes: string[],
  opts: Opts = defaultOpts,
): string[] => {
  const prefixedPackages: string[] = [];

  nodeModulesPaths.forEach((nodeModulesPath) => {
    fs.readdirSync(nodeModulesPath)
      .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
      .filter((name) => !name.startsWith('.'))
      .forEach((folderName) => {
        const packageJsonPath = path.resolve(
          nodeModulesPath,
          folderName,
          'package.json',
        );
        if (fs.existsSync(packageJsonPath)) {
          const { name } = JSON.parse(
            fs.readFileSync(packageJsonPath, 'utf-8'),
          ) as { name: string };
          if (!opts.ignorePackageNames.includes(name)) {
            prefixedPackages.push(name);
          }
        }
      });
  });

  return prefixedPackages;
};
