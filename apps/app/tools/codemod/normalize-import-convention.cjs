/**
 * Codemod: normalize-import-convention (C2, esm-import-convention task 4.2).
 *
 * Transforms apps/app/src import specifiers to the "no-extension" convention by
 * removing extensions ONLY — it preserves each specifier's authored alias/relative
 * form so the migration diff stays minimal (no alias↔relative collapse):
 *
 *   1. Remove .js/.jsx from relative specifiers       ./foo.js → ./foo
 *   2. Normalise /index barrel suffix on relative     ./sub/index.js → ./sub
 *                                                      ./index.js → .
 *   3. Remove .js/.jsx from ~/alias specifiers        ~/states/context.js → ~/states/context
 *   4. Normalise /index barrel suffix on ~/alias      ~/utils/logger/index.js → ~/utils/logger
 *   5. Preserve the authored form — a ~/alias stays a ~/alias, a relative stays
 *      relative. The choice between alias and relative is a separate, documented
 *      style guideline (see .claude/rules/import-convention.md), not enforced here.
 *   6. Leave external packages / ^/ / .json / .cjs / .scss unchanged
 *
 * Applies to both value and type-only import/export specifiers. Because the
 * transform is purely lexical (no filesystem resolution), it never needs the
 * source tree and cannot misclassify a specifier.
 *
 * Usage (jscodeshift transform API):
 *   jscodeshift --transform tools/codemod/normalize-import-convention.cjs src/**
 *   or: node tools/codemod/normalize-import-convention.cjs [--dry] [src/path...]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const jscodeshift = require('jscodeshift');

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx)$/;

// ──────────────────────────────────────────────────────────────────────────────
// Helper: normalise a specifier node value
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Non-TS file extensions that must not be touched.
 */
const INVARIANT_EXTENSIONS =
  /\.(json|cjs|mjs|scss|css|svg|png|jpg|jpeg|gif|woff|woff2)$/;

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
 * @returns {string | undefined}
 */
function transform(file, api) {
  const j = api.jscodeshift;

  let root;
  try {
    root = j(file.source);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: CLI diagnostics
    console.error(
      `[normalize-import-convention] parse failed: ${file.path}`,
      err.message,
    );
    return undefined;
  }

  let changed = 0;

  forEachSpecifier(j, root, (node) => {
    const original = node.value;

    if (isInvariant(original)) return;

    // Only relative (./ ../) and ~/ alias specifiers are in scope. The authored
    // form is preserved — a ~/alias stays a ~/alias, a relative stays relative;
    // we only strip the .js/.jsx extension and normalise the /index barrel.
    // Intentionally NO alias↔relative collapse, to keep the migration diff minimal.
    if (
      !original.startsWith('~/') &&
      !original.startsWith('./') &&
      !original.startsWith('../')
    ) {
      return;
    }

    const stripped = stripExtension(original);
    if (stripped !== original) {
      node.value = stripped;
      if (node.extra) node.extra = undefined;
      if (typeof node.raw === 'string') node.raw = undefined;
      changed += 1;
    }
  });

  if (changed === 0) return undefined; // no changes — jscodeshift convention
  return root.toSource({ quote: 'single' });
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ──────────────────────────────────────────────────────────────────────────────

// `generated` (e.g. the gitignored Prisma client) is regenerated with its own
// `.js`-suffixed specifiers and is not hand-written source — never transform it.
const EXCLUDED_DIRS = new Set(['node_modules', 'generated']);

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
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

  const targets =
    args.length > 0 ? args.map((a) => path.resolve(a)) : walk(srcRoot, []);

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
      console.log(
        `  ${dryRun ? '(dry) ' : ''}${path.relative(appRoot, filePath)}`,
      );
    }
  }

  // biome-ignore lint/suspicious/noConsole: CLI summary
  console.log(
    `[normalize-import-convention] rewritten ${totalFiles} file(s) with ${totalChanges} change(s)`,
  );
}

module.exports = transform;
