/**
 * Codemod: convert value-level RELATIVE imports to `~/` alias form inside the
 * src/server subtree that is reachable from the client/SSR build
 * (esm-migration task 3.4 companion).
 *
 * Why: Turbopack (next build) does not apply TypeScript's `.js` -> `.ts`
 * extension substitution to relative imports, so the `.js`-suffixed relative
 * specifiers produced by the ts2esm pass break `build:client` for every
 * src/server module that the SSR graph pulls in (verified on Next 16.2:
 * `Module not found: Can't resolve '../../models/subscription.js'`).
 * Alias specifiers (`~/server/...`) resolve through tsconfig `paths` in every
 * pipeline (Turbopack, tsgo, tspc + typescript-transform-paths, ts-node +
 * tsconfig-paths, vitest + vite-tsconfig-paths), and stay extensionless until
 * the NodeNext alias pass (task 3.6). Type-only imports are erased before
 * bundler resolution, so they keep their `.js` relative form.
 *
 * What it does:
 *   1. Collects roots: server files value-imported from anywhere in src/**
 *      outside src/server (pages, features, client) — an over-approximation
 *      of the SSR-reachable entry set.
 *   2. Computes the value-import closure of those roots within src/server
 *      (static imports, re-exports, literal dynamic imports; type-only edges
 *      are ignored because SWC strips them before resolution).
 *   3. Rewrites every value-level relative specifier inside closure files to
 *      `~/<path-from-src>` form (stripping `/index` and the extension).
 *
 * Usage: node tools/codemod/ssr-relative-to-alias.cjs [--dry]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(APP_ROOT, 'src');
const SERVER = path.join(SRC, 'server');

const jscodeshift = require('jscodeshift');

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx)$/;

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(p, acc);
    } else if (SOURCE_FILE_RE.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Resolve a `~/`, `^/` or relative specifier to an absolute file path. */
function resolveFile(fromDir, spec) {
  let base;
  if (spec.startsWith('~/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('^/')) base = path.join(APP_ROOT, spec.slice(2));
  else if (
    spec === '.' ||
    spec === '..' ||
    spec.startsWith('./') ||
    spec.startsWith('../')
  ) {
    base = path.resolve(fromDir, spec);
  } else return null;

  for (const stem of [base, base.replace(/\.js$/, '')]) {
    for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.d.ts']) {
      const f = stem + suffix;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    for (const suffix of [
      '/index.ts',
      '/index.tsx',
      '/index.js',
      '/index.jsx',
    ]) {
      const f = stem + suffix;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
  }
  return null;
}

function parse(file, source) {
  const parser = file.endsWith('.tsx') || file.endsWith('.jsx') ? 'tsx' : 'ts';
  return jscodeshift.withParser(parser)(source);
}

/**
 * Visit every value-level import-ish specifier of a parsed file.
 * Type-only declarations/specifier-sets are skipped (erased before bundling).
 */
function forEachValueSpecifier(j, root, visit) {
  root.find(j.ImportDeclaration).forEach((p) => {
    const n = p.node;
    if (n.importKind === 'type') return;
    const hasValueSpecifier =
      !n.specifiers ||
      n.specifiers.length === 0 ||
      n.specifiers.some((s) => s.importKind !== 'type');
    if (hasValueSpecifier && typeof n.source.value === 'string')
      visit(n.source);
  });
  root.find(j.ExportNamedDeclaration).forEach((p) => {
    const n = p.node;
    if (!n.source || n.exportKind === 'type') return;
    const hasValueSpecifier =
      !n.specifiers ||
      n.specifiers.length === 0 ||
      n.specifiers.some((s) => s.exportKind !== 'type');
    if (hasValueSpecifier && typeof n.source.value === 'string')
      visit(n.source);
  });
  root.find(j.ExportAllDeclaration).forEach((p) => {
    const n = p.node;
    if (n.exportKind === 'type') return;
    if (n.source && typeof n.source.value === 'string') visit(n.source);
  });
  root.find(j.CallExpression, { callee: { type: 'Import' } }).forEach((p) => {
    const [arg] = p.node.arguments;
    if (
      arg &&
      (arg.type === 'StringLiteral' || arg.type === 'Literal') &&
      typeof arg.value === 'string'
    ) {
      visit(arg);
    }
  });
}

function collectValueEdges(file) {
  const source = fs.readFileSync(file, 'utf8');
  let root;
  try {
    root = parse(file, source);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI diagnostics.
    console.error(
      `[ssr-relative-to-alias] parse failed: ${file}`,
      error.message,
    );
    return [];
  }
  const j = jscodeshift.withParser('ts');
  const edges = [];
  forEachValueSpecifier(j, root, (node) => edges.push(node.value));
  return edges;
}

/** `/abs/src/server/models/user/index.js` -> `~/server/models/user` */
function toAliasSpecifier(absoluteTarget) {
  const rel = path.relative(SRC, absoluteTarget).split(path.sep).join('/');
  const stripped = rel
    .replace(/\.d\.ts$/, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '');
  return `~/${stripped}`;
}

function computeClosure() {
  const allSrcFiles = walk(SRC, []);
  const outside = allSrcFiles.filter((f) => !f.startsWith(SERVER + path.sep));

  const roots = new Set();
  for (const file of outside) {
    for (const spec of collectValueEdges(file)) {
      const resolved = resolveFile(path.dirname(file), spec);
      if (resolved?.startsWith(SERVER + path.sep)) roots.add(resolved);
    }
  }

  const closure = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (closure.has(file)) continue;
    closure.add(file);
    for (const spec of collectValueEdges(file)) {
      const resolved = resolveFile(path.dirname(file), spec);
      if (resolved?.startsWith(SERVER + path.sep) && !closure.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return closure;
}

function rewriteFile(file, dryRun) {
  const source = fs.readFileSync(file, 'utf8');
  const root = parse(file, source);
  const j = jscodeshift.withParser('ts');
  const dir = path.dirname(file);
  let changed = 0;

  forEachValueSpecifier(j, root, (node) => {
    const spec = node.value;
    const isRelative =
      spec === '.' ||
      spec === '..' ||
      spec.startsWith('./') ||
      spec.startsWith('../');
    if (!isRelative) return;
    const resolved = resolveFile(dir, spec);
    if (resolved == null) {
      // biome-ignore lint/suspicious/noConsole: CLI diagnostics.
      console.warn(
        `[ssr-relative-to-alias] unresolvable: ${file} -> '${spec}'`,
      );
      return;
    }
    const alias = toAliasSpecifier(resolved);
    node.value = alias;
    if (node.extra) node.extra = undefined;
    if (typeof node.raw === 'string') node.raw = undefined;
    changed += 1;
  });

  if (changed > 0 && !dryRun) {
    fs.writeFileSync(file, root.toSource({ quote: 'single' }));
  }
  return changed;
}

function main() {
  const dryRun = process.argv.includes('--dry');
  const closure = computeClosure();
  // biome-ignore lint/suspicious/noConsole: CLI summary output.
  console.log(
    `[ssr-relative-to-alias] SSR-reachable closure: ${closure.size} files`,
  );

  let totalRewrites = 0;
  let touchedFiles = 0;
  for (const file of [...closure].sort()) {
    const changed = rewriteFile(file, dryRun);
    if (changed > 0) {
      touchedFiles += 1;
      totalRewrites += changed;
      // biome-ignore lint/suspicious/noConsole: CLI summary output.
      console.log(
        `  ${dryRun ? '(dry) ' : ''}${path.relative(SERVER, file)}: ${changed}`,
      );
    }
  }
  // biome-ignore lint/suspicious/noConsole: CLI summary output.
  console.log(
    `[ssr-relative-to-alias] rewrote ${totalRewrites} specifier(s) in ${touchedFiles} file(s)`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { computeClosure, toAliasSpecifier, resolveFile };
