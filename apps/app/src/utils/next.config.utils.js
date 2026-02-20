// workaround by https://github.com/martpie/next-transpile-modules/issues/143#issuecomment-817467144

const fs = require('node:fs');
const path = require('node:path');

const nodeModulesPaths = [
  path.resolve(__dirname, '../../node_modules'),
  path.resolve(__dirname, '../../../../node_modules'),
];

/**
 * @typedef { { ignorePackageNames: string[] } } Opts
 */

/** @type {Opts} */
const defaultOpts = { ignorePackageNames: [] };

/**
 * @param scopes {string[]}
 */
exports.listScopedPackages = (scopes, opts = defaultOpts) => {
  /** @type {string[]} */
  const scopedPackages = [];

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
              const { name } = require(packageJsonPath);
              if (!opts.ignorePackageNames.includes(name)) {
                scopedPackages.push(name);
              }
            }
          });
      });
  });

  return scopedPackages;
};

/**
 * @param prefixes {string[]}
 */
/**
 * Webpack plugin that logs eager (initial) vs lazy (async-only) module counts.
 * Attach to client-side dev builds only.
 */
exports.createChunkModuleStatsPlugin = () => ({
  apply(compiler) {
    compiler.hooks.done.tap('ChunkModuleStatsPlugin', (stats) => {
      const { compilation } = stats;
      const initialModuleIds = new Set();
      const asyncModuleIds = new Set();

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

      // Dump initial module details to file for analysis (only for large compilations)
      if (
        initialModuleIds.size > 500 &&
        process.env.DUMP_INITIAL_MODULES === '1'
      ) {
        const packageCounts = {};
        const appModules = [];
        for (const id of initialModuleIds) {
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
        const lines = ['# Initial Chunk Module Analysis', ''];
        lines.push(`Total initial modules: ${initialModuleIds.size}`);
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
        const outPath = path.resolve(
          compiler.outputPath,
          '..',
          'initial-modules-analysis.md',
        );
        fs.writeFileSync(outPath, lines.join('\n'));
        // biome-ignore lint/suspicious/noConsole: Dev-only module stats dump path
        console.log(
          `[ChunkModuleStats] Dumped initial module analysis to ${outPath}`,
        );
      }
    });
  },
});

exports.listPrefixedPackages = (prefixes, opts = defaultOpts) => {
  /** @type {string[]} */
  const prefixedPackages = [];

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
          const { name } = require(packageJsonPath);
          if (!opts.ignorePackageNames.includes(name)) {
            prefixedPackages.push(name);
          }
        }
      });
  });

  return prefixedPackages;
};
