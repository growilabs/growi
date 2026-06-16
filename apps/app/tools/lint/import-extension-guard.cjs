/**
 * Import extension guard lint tool (C3, esm-import-convention task 6).
 *
 * Detects relative (./  ../) and ~/alias specifiers that contain .js or .jsx
 * extensions, which violate the canonical "no-extension" import convention.
 *
 * Invariant specifiers that are NOT checked:
 *   - External npm packages (no leading ./  ../  ~/  ^/)
 *   - .json / .cjs / .mjs / .scss / .css and other non-TS asset extensions
 *   - ^/ alias (e.g. ^/package.json or ^/config/*.cjs)
 *
 * Usage:
 *   node tools/lint/import-extension-guard.cjs [<file|dir> ...]
 *   Exits with code 1 if any violations are found.
 *
 * With --fix: applies normalize-import-convention.cjs to each violating file.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const jscodeshift = require('jscodeshift');

// ──────────────────────────────────────────────────────────────────────────────
// Patterns
// ──────────────────────────────────────────────────────────────────────────────

/** Extensions that are violations when present in relative or ~/alias specifiers. */
const VIOLATION_EXT_RE = /\.(js|jsx)$/;

/** Non-TS asset extensions that are allowed as-is (should NOT be modified). */
const INVARIANT_ASSET_RE = /\.(json|cjs|mjs|scss|css|svg|png|jpg|jpeg|gif|woff|woff2|d\.ts)$/;

// ──────────────────────────────────────────────────────────────────────────────
// Core: collectViolations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Return the list of violations in `source` (for `filename`).
 *
 * @param {string} source    file content
 * @param {string} filename  file path (used in violation messages)
 * @returns {{ file: string; line: number; rule: string; detail: string }[]}
 */
function collectViolations(source, filename) {
  const parser = filename.endsWith('.tsx') || filename.endsWith('.jsx') ? 'tsx' : 'ts';
  const j = jscodeshift.withParser(parser);

  let root;
  try {
    root = j(source);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: lint diagnostic
    console.error(`[import-extension-guard] parse failed: ${filename}`, err.message);
    return [];
  }

  /** @type {{ file: string; line: number; rule: string; detail: string }[]} */
  const violations = [];

  /**
   * Check a single specifier value and push a violation if needed.
   *
   * @param {string} spec   the specifier string
   * @param {number} line   1-based line number
   */
  function checkSpec(spec, line) {
    // Only check relative (./../) and ~/alias specifiers
    const isRelative = spec.startsWith('./') || spec.startsWith('../');
    const isAlias = spec.startsWith('~/');

    if (!isRelative && !isAlias) return; // external or ^/ — skip

    // Allow invariant asset extensions
    if (INVARIANT_ASSET_RE.test(spec)) return;

    // Violation: .js or .jsx extension in relative/alias specifier
    if (VIOLATION_EXT_RE.test(spec)) {
      violations.push({
        file: filename,
        line,
        rule: 'import-extension',
        detail: `specifier '${spec}' must not contain '${spec.match(VIOLATION_EXT_RE)?.[0] ?? '.js'}' — use extensionless form`,
      });
    }
  }

  /** Get the 1-based line number of an AST node. */
  function lineOf(node) {
    return node.loc?.start?.line ?? 0;
  }

  // Static import declarations (value and type-only)
  root.find(j.ImportDeclaration).forEach((p) => {
    const n = p.node;
    if (typeof n.source.value === 'string') {
      checkSpec(n.source.value, lineOf(n));
    }
  });

  // export { ... } from '...' and export * from '...'
  root.find(j.ExportNamedDeclaration).forEach((p) => {
    const n = p.node;
    if (n.source && typeof n.source.value === 'string') {
      checkSpec(n.source.value, lineOf(n));
    }
  });
  root.find(j.ExportAllDeclaration).forEach((p) => {
    const n = p.node;
    if (n.source && typeof n.source.value === 'string') {
      checkSpec(n.source.value, lineOf(n));
    }
  });

  // dynamic import('...')
  root.find(j.CallExpression, { callee: { type: 'Import' } }).forEach((p) => {
    const [arg] = p.node.arguments;
    if (
      arg &&
      (arg.type === 'StringLiteral' || arg.type === 'Literal') &&
      typeof arg.value === 'string'
    ) {
      checkSpec(arg.value, lineOf(p.node));
    }
  });

  return violations;
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────────

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx)$/;

// Directories excluded from the convention: dependencies and generated code.
// `src/generated/**` is gitignored output (e.g. the Prisma client, regenerated
// with its own `.js`-suffixed specifiers by `prisma generate`) and is not
// hand-written source, so the no-extension rule does not apply to it.
const EXCLUDED_DIRS = new Set(['node_modules', 'generated']);

function walkFiles(target, acc = []) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        walkFiles(path.join(target, entry.name), acc);
      } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
        acc.push(path.join(target, entry.name));
      }
    }
  } else if (SOURCE_FILE_RE.test(target)) {
    acc.push(target);
  }
  return acc;
}

if (require.main === module) {
  const doFix = process.argv.includes('--fix');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

  const appRoot = path.resolve(__dirname, '../..');
  const targets = args.length > 0
    ? args.flatMap((a) => walkFiles(path.resolve(a)))
    : walkFiles(path.join(appRoot, 'src'));

  /** @type {{ file: string; line: number; rule: string; detail: string }[]} */
  let allViolations = [];

  for (const filePath of targets) {
    const source = fs.readFileSync(filePath, 'utf8');
    const violations = collectViolations(source, filePath);
    allViolations = allViolations.concat(violations);
  }

  if (allViolations.length === 0) {
    // biome-ignore lint/suspicious/noConsole: CLI summary
    console.log('[import-extension-guard] No violations found.');
    process.exit(0);
  }

  for (const v of allViolations) {
    // biome-ignore lint/suspicious/noConsole: CLI diagnostic
    console.error(`${v.file}:${v.line}: [${v.rule}] ${v.detail}`);
  }
  // biome-ignore lint/suspicious/noConsole: CLI summary
  console.error(
    `[import-extension-guard] ${allViolations.length} violation(s) found.`,
  );

  if (doFix) {
    // Apply normalize-import-convention to each violating file
    const normalize = require('../codemod/normalize-import-convention.cjs');
    const violatingFiles = [...new Set(allViolations.map((v) => v.file))];
    for (const filePath of violatingFiles) {
      const ext = path.extname(filePath);
      const parser = ext === '.tsx' || ext === '.jsx' ? 'tsx' : 'ts';
      const j = jscodeshift.withParser(parser);
      const source = fs.readFileSync(filePath, 'utf8');
      const result = normalize(
        { source, path: filePath },
        { jscodeshift: j, j, stats: () => {} },
        { appRoot },
      );
      if (result != null) {
        fs.writeFileSync(filePath, result, 'utf8');
        // biome-ignore lint/suspicious/noConsole: CLI summary
        console.log(`[import-extension-guard] fixed: ${filePath}`);
      }
    }
    process.exit(0);
  }

  process.exit(1);
}

module.exports = { collectViolations };
