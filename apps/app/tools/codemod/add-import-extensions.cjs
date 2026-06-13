/**
 * jscodeshift transform: add explicit file extensions to relative import
 * specifiers (esm-migration task 3.4, second pass after ts2esm).
 *
 * ts2esm only visits static import/export declarations. This transform sweeps
 * every literal specifier position so the tree ends with zero extensionless
 * relative specifiers:
 *   - static `import ... from './x'` / side-effect `import './x'`
 *   - `export { ... } from './x'` / `export * from './x'`
 *   - dynamic `import('./x')` call expressions (string literals only)
 *   - TSImportType type references (`foo!: import('../y').Bar`)
 *   - `.d.ts`-only targets (`./types` -> `./types.js` when only types.d.ts
 *     exists) which ts2esm's path finder cannot resolve
 *
 * Resolution mirrors ts2esm's PathFinder candidate order, extended with
 * `.d.ts` (-> .js) and `.json` (-> .json):
 *   ./x   -> ./x.js          (x.ts / x.tsx / x.js / x.jsx / x.d.ts on disk)
 *   ./x   -> ./x.cjs|.mjs    (x.cts|x.cjs / x.mts|x.mjs on disk)
 *   ./dir -> ./dir/index.js  (dir/index.ts ... on disk)
 *
 * Alias specifiers (task 3.6 NodeNext pass): `~/` (-> `<appRoot>/src/`) and
 * `^/` (-> `<appRoot>/`) are resolved against the same candidate table and
 * rewritten in place (`~/x` -> `~/x.js`, `~/dir` -> `~/dir/index.js`). The
 * app root defaults to two directories above this file and can be overridden
 * with the jscodeshift option `aliasRoot` (used by the tests).
 *
 * Untouched on purpose:
 *   - bare package specifiers
 *   - specifiers that already end in .js/.cjs/.mjs/.json/.node (the
 *     `^/config/*.cjs` trio stays `.cjs`)
 *   - template-literal / non-literal dynamic imports (runtime-resolved)
 *   - unresolvable specifiers (reported on stderr instead of guessing)
 *
 * CLI wrapper: `pnpm run codemod:add-import-extensions -- <path> [<path> ...]`
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Pure resolution core ────────────────────────────────────────────────────

// Candidate extension table, ordered (ts2esm PathFinder order, extended with
// .d.ts and .json). The first candidate that exists on disk wins.
const EXTENSION_CANDIDATES = [
  { candidate: '.ts', replacement: '.js' },
  { candidate: '.tsx', replacement: '.js' },
  { candidate: '.js', replacement: '.js' },
  { candidate: '.jsx', replacement: '.js' },
  { candidate: '.cts', replacement: '.cjs' },
  { candidate: '.mts', replacement: '.mjs' },
  { candidate: '.cjs', replacement: '.cjs' },
  { candidate: '.mjs', replacement: '.mjs' },
  { candidate: '.d.ts', replacement: '.js' },
  { candidate: '.json', replacement: '.json' },
];

const ALREADY_EXTENDED_RE = /\.(?:js|cjs|mjs|json|node)$/;

// tsconfig paths aliases used across apps/app: prefix in the specifier and
// the directory (relative to the app root) it maps to.
const ALIAS_ROOTS = [
  { prefix: '~/', dir: 'src' },
  { prefix: '^/', dir: '.' },
];

/** @param {string} spec */
function isRelativeSpecifier(spec) {
  return (
    spec === '.' ||
    spec === '..' ||
    spec.startsWith('./') ||
    spec.startsWith('../')
  );
}

/** @param {string} spec */
function isAliasSpecifier(spec) {
  return ALIAS_ROOTS.some(({ prefix }) => spec.startsWith(prefix));
}

/**
 * Probe the candidate table against an absolute base path and return the
 * specifier suffix to append (`.js`, `/index.js`, ...) or null.
 *
 * @param {string} base - absolute path of the specifier without extension
 */
function findExtensionSuffix(base) {
  for (const suffix of ['', '/index']) {
    for (const { candidate, replacement } of EXTENSION_CANDIDATES) {
      if (fs.existsSync(base + suffix + candidate)) {
        return suffix + replacement;
      }
    }
  }
  return null;
}

/**
 * Compute the explicit-extension form of a relative specifier.
 *
 * @param {string} importerDir - absolute directory of the importing file
 * @param {string} spec - the specifier as written in the source
 * @returns {string|null} the rewritten specifier, or null when the specifier
 *   must be left untouched (non-relative, already extended, or unresolvable)
 */
function resolveSpecifier(importerDir, spec) {
  if (!isRelativeSpecifier(spec)) return null;
  if (ALREADY_EXTENDED_RE.test(spec)) return null;

  const cleanSpec = spec.endsWith('/') ? spec.slice(0, -1) : spec;
  const base = path.resolve(importerDir, cleanSpec);

  const suffix = findExtensionSuffix(base);
  return suffix == null ? null : cleanSpec + suffix;
}

/**
 * Compute the explicit-extension form of a `~/` or `^/` alias specifier.
 *
 * @param {string} aliasRoot - absolute app root the aliases are mapped against
 * @param {string} spec - the specifier as written in the source
 * @returns {string|null} the rewritten specifier, or null when the specifier
 *   must be left untouched (not an alias, already extended, or unresolvable)
 */
function resolveAliasSpecifier(aliasRoot, spec) {
  if (ALREADY_EXTENDED_RE.test(spec)) return null;

  for (const { prefix, dir } of ALIAS_ROOTS) {
    if (!spec.startsWith(prefix)) continue;

    const cleanSpec = spec.endsWith('/') ? spec.slice(0, -1) : spec;
    const base = path.join(aliasRoot, dir, cleanSpec.slice(prefix.length));

    const suffix = findExtensionSuffix(base);
    return suffix == null ? null : cleanSpec + suffix;
  }
  return null;
}

// ─── jscodeshift adapter ─────────────────────────────────────────────────────

/**
 * @param {import('jscodeshift').FileInfo} fileInfo
 * @param {import('jscodeshift').API} api
 */
module.exports = function transformer(fileInfo, api, options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const importerDir = path.dirname(path.resolve(fileInfo.path));
  const aliasRoot =
    (options && options.aliasRoot) || path.resolve(__dirname, '../..');

  let changed = false;
  /** @type {string[]} */
  const unresolved = [];

  /** Rewrite a string-literal AST node in place, preserving its quote style. */
  function updateLiteral(node) {
    if (node == null || typeof node.value !== 'string') return;
    const spec = node.value;
    const isRelative = isRelativeSpecifier(spec);
    const isAlias = isAliasSpecifier(spec);
    if ((!isRelative && !isAlias) || ALREADY_EXTENDED_RE.test(spec)) return;

    const next = isRelative
      ? resolveSpecifier(importerDir, spec)
      : resolveAliasSpecifier(aliasRoot, spec);
    if (next == null) {
      unresolved.push(spec);
      return;
    }

    node.value = next;
    // Invalidate the cached raw text so recast reprints the literal
    // (with the single-quote style passed to toSource below).
    if (node.extra) {
      node.extra = undefined;
    }
    if (typeof node.raw === 'string') {
      node.raw = undefined;
    }
    changed = true;
  }

  // Static import declarations (covers side-effect and type-only imports).
  root.find(j.ImportDeclaration).forEach((p) => {
    updateLiteral(p.node.source);
  });

  // Re-exports: export { x } from './x'; / export * from './x';
  root.find(j.ExportNamedDeclaration).forEach((p) => {
    if (p.node.source) updateLiteral(p.node.source);
  });
  root.find(j.ExportAllDeclaration).forEach((p) => {
    updateLiteral(p.node.source);
  });

  // Dynamic import('./x') — babel parsers represent the callee as `Import`.
  root.find(j.CallExpression, { callee: { type: 'Import' } }).forEach((p) => {
    const [arg] = p.node.arguments;
    if (arg && (arg.type === 'StringLiteral' || arg.type === 'Literal')) {
      updateLiteral(arg);
    }
  });
  // ESTree-style parsers represent dynamic import as ImportExpression.
  if (j.ImportExpression) {
    root.find(j.ImportExpression).forEach((p) => {
      const source = p.node.source;
      if (
        source &&
        (source.type === 'StringLiteral' || source.type === 'Literal')
      ) {
        updateLiteral(source);
      }
    });
  }

  // TSImportType: `foo!: import('../y').Bar` (type position, still resolved
  // by the compiler, so it needs the extension too).
  root.find(j.TSImportType).forEach((p) => {
    const arg = p.node.argument;
    if (arg == null) return;
    if (arg.type === 'StringLiteral' || arg.type === 'Literal') {
      updateLiteral(arg);
    } else if (
      arg.type === 'TSLiteralType' &&
      arg.literal?.type === 'StringLiteral'
    ) {
      updateLiteral(arg.literal);
    }
  });

  if (unresolved.length > 0) {
    // biome-ignore lint/suspicious/noConsole: surfacing unresolvable specifiers is the CLI contract.
    console.warn(
      `[add-import-extensions] ${fileInfo.path}: left ${unresolved.length} unresolvable relative specifier(s) untouched: ${unresolved.join(', ')}`,
    );
  }

  if (!changed) return undefined;
  // Only modified literals are reprinted; 'single' matches the Biome style
  // enforced across the repository (same choice as cjs-to-esm.cjs).
  return root.toSource({ quote: 'single' });
};

module.exports.resolveSpecifier = resolveSpecifier;
module.exports.resolveAliasSpecifier = resolveAliasSpecifier;
module.exports.isRelativeSpecifier = isRelativeSpecifier;

// ─── CLI entry point ─────────────────────────────────────────────────────────
// Mirrors tools/codemod/cjs-to-esm.cjs: when run directly, wrap the
// jscodeshift CLI so the transform can be applied per directory.
if (require.main === module) {
  const { execFileSync } = require('node:child_process');

  const args = process.argv.slice(2);
  if (args.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI usage message.
    console.error(
      'Usage: node tools/codemod/add-import-extensions.cjs <path> [<path> ...]',
    );
    process.exit(1);
  }

  const targetPaths = args.map((a) => path.resolve(a));

  // Resolve to the actual JS entry point, not the shell wrapper in .bin/
  const jscodeshift = require.resolve('jscodeshift/bin/jscodeshift.js');
  const transformPath = __filename;

  // The babel 'ts' parser cannot parse JSX (fails on spread attributes), so
  // JSX-capable extensions need a separate pass with the 'tsx' parser.
  // Explicit file arguments bypass jscodeshift's --extensions filter, so
  // split them per pass here; directories participate in both passes.
  const passes = [
    { extensions: 'js,ts', parser: 'ts', fileRe: /\.(js|ts)$/ },
    { extensions: 'jsx,tsx', parser: 'tsx', fileRe: /\.(jsx|tsx)$/ },
  ];
  try {
    for (const { extensions, parser, fileRe } of passes) {
      const passPaths = targetPaths.filter((p) => {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return true;
        return fileRe.test(p);
      });
      if (passPaths.length === 0) continue;
      execFileSync(
        process.execPath,
        [
          jscodeshift,
          '--transform',
          transformPath,
          '--extensions',
          extensions,
          '--parser',
          parser,
          '--ignore-pattern',
          '**/node_modules/**',
          '--ignore-pattern',
          '**/src/migrations/**',
          ...passPaths,
        ],
        { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') },
      );
    }
  } catch {
    process.exit(1);
  }
}
