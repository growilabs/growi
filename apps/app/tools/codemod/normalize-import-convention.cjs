/**
 * Codemod: normalize-import-convention (C2, esm-import-convention task 4.2).
 *
 * Transforms apps/app/src import specifiers to the canonical "no-extension" convention:
 *
 *   1. Remove .js/.jsx from relative specifiers       ./foo.js → ./foo
 *   2. Remove /index.js barrel suffix from relative   ./sub/index.js → ./sub
 *   3. Remove .js/.jsx from ~/alias specifiers        ~/states/context.js → ~/states/context
 *   4. Remove /index.js from ~/alias barrel imports   ~/utils/logger/index.js → ~/utils/logger
 *   5. Collapse local ~/alias to extensionless relative when the resolved target
 *      is in the same src/ first-level subtree as the importer
 *      (~/client/components/Foo.js from src/client/… → ../Foo)
 *   6. Leave external packages / .json / .cjs / .scss unchanged
 *   7. If a specifier is unresolvable: leave unchanged + warn (no crash)
 *
 * Applies to both value and type-only import/export specifiers.
 *
 * Usage (jscodeshift transform API):
 *   jscodeshift --transform tools/codemod/normalize-import-convention.cjs src/**
 *   or: node tools/codemod/normalize-import-convention.cjs [--dry] [src/path...]
 *
 * Options (transform options object or CLI):
 *   appRoot: absolute path to the apps/app directory (default: __dirname/../..)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const jscodeshift = require('jscodeshift');

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx)$/;

// ──────────────────────────────────────────────────────────────────────────────
// Helper: resolveFile (borrowed from ssr-relative-to-alias.cjs)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a specifier (relative, ~/, ^/) to an absolute file path in the
 * source tree. Returns null if unresolvable.
 *
 * @param {string} srcRoot  absolute path to apps/app/src
 * @param {string} appRoot  absolute path to apps/app
 * @param {string} fromDir  absolute path of the directory containing the importer
 * @param {string} spec     the specifier string
 * @returns {string | null}
 */
function resolveFile(srcRoot, appRoot, fromDir, spec) {
  let base;
  if (spec.startsWith('~/')) base = path.join(srcRoot, spec.slice(2));
  else if (spec.startsWith('^/')) base = path.join(appRoot, spec.slice(2));
  else if (
    spec === '.' ||
    spec === '..' ||
    spec.startsWith('./') ||
    spec.startsWith('../')
  ) {
    base = path.resolve(fromDir, spec);
  } else {
    return null; // external package
  }

  // Try with .js suffix stripped (specifier may already have .js)
  for (const stem of [base, base.replace(/\.js$/, '').replace(/\/index$/, '')]) {
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.d.ts']) {
      const f = stem + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    for (const idx of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
      const f = stem + idx;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: normalise a specifier node value
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Non-TS file extensions that must not be touched.
 */
const INVARIANT_EXTENSIONS = /\.(json|cjs|mjs|scss|css|svg|png|jpg|jpeg|gif|woff|woff2)$/;

/**
 * Return true if the specifier should not be modified (external / non-TS asset).
 *
 * @param {string} spec
 * @returns {boolean}
 */
function isInvariant(spec) {
  // External npm packages (no leading ./ ../ ~/ ^/)
  if (
    !spec.startsWith('./') &&
    !spec.startsWith('../') &&
    !spec.startsWith('~/') &&
    !spec.startsWith('^/')
  ) {
    return true;
  }
  // Non-TS asset imports (.json / .cjs / .scss / …)
  const bare = spec.split('?')[0];
  if (INVARIANT_EXTENSIONS.test(bare)) return true;
  return false;
}

/**
 * Strip .js/.jsx extension and /index suffix from a specifier.
 * Does NOT handle alias→relative conversion.
 *
 * @param {string} spec
 * @returns {string}
 */
function stripExtension(spec) {
  // Remove /index.js or /index.jsx or /index
  let s = spec.replace(/\/index\.(js|jsx)$/, '').replace(/\/index$/, '');
  // Remove trailing .js or .jsx (but not .cjs/.mjs/.json/.scss/…)
  s = s.replace(/\.(js|jsx)$/, '');
  return s;
}

/**
 * Convert an absolute file path to an alias specifier (~/relative-from-src).
 *
 * @param {string} srcRoot
 * @param {string} absoluteTarget
 * @returns {string}
 */
function toAliasSpecifier(srcRoot, absoluteTarget) {
  const rel = path.relative(srcRoot, absoluteTarget).split(path.sep).join('/');
  const stripped = rel
    .replace(/\.d\.ts$/, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '');
  return `~/${stripped}`;
}

/**
 * Convert an absolute file path to a relative specifier from `fromDir`.
 *
 * @param {string} fromDir
 * @param {string} absoluteTarget
 * @returns {string}
 */
function toRelativeSpecifier(fromDir, absoluteTarget) {
  const srcRoot = path.dirname(absoluteTarget); // not used — compute relative
  let rel = path.relative(fromDir, absoluteTarget).split(path.sep).join('/');
  // Strip extension + /index
  rel = rel
    .replace(/\.d\.ts$/, '')
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/\/index$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

/**
 * Determine whether `absoluteTarget` is "local" to `importerFile`, meaning
 * both share the same first-level directory under `srcRoot` (e.g. both under
 * src/client/ or both under src/server/).
 *
 * @param {string} srcRoot
 * @param {string} importerFile  absolute path of the importer
 * @param {string} absoluteTarget  absolute path of the resolved target
 * @returns {boolean}
 */
function isLocal(srcRoot, importerFile, absoluteTarget) {
  const importerRel = path.relative(srcRoot, importerFile);
  const targetRel = path.relative(srcRoot, absoluteTarget);

  const importerTopDir = importerRel.split(path.sep)[0];
  const targetTopDir = targetRel.split(path.sep)[0];

  // Both must be under src/ (not outside)
  if (!importerTopDir || !targetTopDir) return false;
  // Same first-level directory = local
  return importerTopDir === targetTopDir;
}

// ──────────────────────────────────────────────────────────────────────────────
// Core: visit all specifier nodes (value + type-only)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Visit every import/export specifier node (both value and type-only).
 * The visitor receives the AST node for the source literal so it can be
 * mutated in place.
 *
 * @param {import('jscodeshift').JSCodeshift} j
 * @param {import('jscodeshift').Collection} root
 * @param {(node: { value: string }) => void} visit
 */
function forEachSpecifier(j, root, visit) {
  // import declarations (value and type)
  root.find(j.ImportDeclaration).forEach((p) => {
    const n = p.node;
    if (typeof n.source.value === 'string') visit(n.source);
  });

  // export { ... } from '...' and export * from '...'
  root.find(j.ExportNamedDeclaration).forEach((p) => {
    const n = p.node;
    if (n.source && typeof n.source.value === 'string') visit(n.source);
  });
  root.find(j.ExportAllDeclaration).forEach((p) => {
    const n = p.node;
    if (n.source && typeof n.source.value === 'string') visit(n.source);
  });

  // dynamic import('...')
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

// ──────────────────────────────────────────────────────────────────────────────
// jscodeshift transform entry point
// ──────────────────────────────────────────────────────────────────────────────

/**
 * jscodeshift transform function.
 *
 * @param {{ source: string; path: string }} file
 * @param {{ jscodeshift: import('jscodeshift').JSCodeshift; j: import('jscodeshift').JSCodeshift }} api
 * @param {{ appRoot?: string }} options
 * @returns {string | undefined}
 */
function transform(file, api, options = {}) {
  const appRoot = options.appRoot || path.resolve(__dirname, '../..');
  const srcRoot = path.join(appRoot, 'src');
  const j = api.jscodeshift;

  const filePath = path.resolve(appRoot, file.path);
  const fromDir = path.dirname(filePath);

  let root;
  try {
    root = j(file.source);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI diagnostics
    console.error(`[normalize-import-convention] parse failed: ${filePath}`, err.message);
    return undefined;
  }

  let changed = 0;

  forEachSpecifier(j, root, (node) => {
    const original = node.value;

    if (isInvariant(original)) return;

    const isAlias = original.startsWith('~/');
    const isRelative =
      original.startsWith('./') || original.startsWith('../');

    if (!isAlias && !isRelative) return;

    // For alias specifiers: try to resolve to determine if local
    if (isAlias) {
      // Always strip .js/.jsx extension and /index from alias
      const stripped = stripExtension(original);

      // Attempt to resolve to check if local
      const resolved = resolveFile(srcRoot, appRoot, fromDir, original);

      if (resolved && isLocal(srcRoot, filePath, resolved)) {
        // Local alias → convert to relative specifier
        const rel = toRelativeSpecifier(fromDir, resolved);
        if (rel !== original) {
          node.value = rel;
          if (node.extra) node.extra = undefined;
          if (typeof node.raw === 'string') node.raw = undefined;
          changed += 1;
        }
      } else {
        // Cross-module alias or unresolvable → strip extension only
        if (stripped !== original) {
          node.value = stripped;
          if (node.extra) node.extra = undefined;
          if (typeof node.raw === 'string') node.raw = undefined;
          changed += 1;
        }
        if (!resolved) {
          // biome-ignore lint/suspicious/noConsole: CLI diagnostics
          console.warn(
            `[normalize-import-convention] unresolvable: ${filePath} -> '${original}'`,
          );
        }
      }
    } else if (isRelative) {
      // Relative specifier: strip extension and /index suffix
      const stripped = stripExtension(original);
      if (stripped !== original) {
        node.value = stripped;
        if (node.extra) node.extra = undefined;
        if (typeof node.raw === 'string') node.raw = undefined;
        changed += 1;
      }
    }
  });

  if (changed === 0) return undefined; // no changes — jscodeshift convention
  return root.toSource({ quote: 'single' });
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ──────────────────────────────────────────────────────────────────────────────

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      walk(p, acc);
    } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const appRoot = path.resolve(__dirname, '../..');
  const srcRoot = path.join(appRoot, 'src');

  const targets = args.length > 0 ? args.map((a) => path.resolve(a)) : walk(srcRoot, []);

  let totalFiles = 0;
  let totalChanges = 0;

  for (const filePath of targets) {
    const ext = path.extname(filePath);
    const parser = ext === '.tsx' || ext === '.jsx' ? 'tsx' : 'ts';
    const j = jscodeshift.withParser(parser);
    const source = fs.readFileSync(filePath, 'utf8');

    const result = transform(
      { source, path: filePath },
      { jscodeshift: j, j, stats: () => {} },
      { appRoot },
    );

    if (result != null && result !== source) {
      totalFiles += 1;
      totalChanges += 1;
      if (!dryRun) {
        fs.writeFileSync(filePath, result, 'utf8');
      }
      // biome-ignore lint/suspicious/noConsole: CLI summary
      console.log(`  ${dryRun ? '(dry) ' : ''}${path.relative(appRoot, filePath)}`);
    }
  }

  // biome-ignore lint/suspicious/noConsole: CLI summary
  console.log(
    `[normalize-import-convention] rewritten ${totalFiles} file(s) with ${totalChanges} change(s)`,
  );
}

module.exports = transform;
