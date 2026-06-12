/**
 * Route top-level side-effect guard (esm-migration task 3.3.h).
 *
 * Under ESM, imports of route modules are hoisted to application boot, BEFORE
 * the Crowi container is initialized. Any top-level execution in a route
 * module therefore runs earlier than it did under CJS (where the central
 * routers require()d leaves inside their factories). This guard pins the
 * allowed top-level shape of `src/server/routes/**` so that runtime-dependent
 * side effects cannot creep back in:
 *
 * Allowed top-level statements:
 *   - import / export declarations (incl. `export * from`)
 *   - TS interface / type-alias / module declarations
 *   - function declarations
 *   - variable declarations whose every initializer is one of:
 *       literal / template / regex / object / array / arrow / function /
 *       identifier / member access / no initializer,
 *       or a call on the explicit allowlist (provably crowi-independent):
 *       loggerFactory(...), express.Router(), Router(), Buffer.from(...)
 *
 * Everything else — bare expression statements, `new X()` initializers,
 * non-allowlisted call initializers — is a violation: move it inside the
 * exported `setup` factory.
 *
 * Additionally, ANY `require(...)` call or `module.exports` / `exports.x`
 * assignment in the file is a violation (CJS regression guard, Req 2.2/2.3).
 *
 * NOTE: the initializer check is intentionally shallow (the top node of each
 * initializer). It guards the load-order hazard class, it does not prove
 * purity of nested expressions.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const jscodeshift = require('jscodeshift');

const j = jscodeshift.withParser('tsx');

const ALLOWED_STATEMENT_TYPES = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSModuleDeclaration',
  'TSEnumDeclaration',
  'FunctionDeclaration',
]);

const ALLOWED_INIT_TYPES = new Set([
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'RegExpLiteral',
  'Literal',
  'TemplateLiteral',
  'ObjectExpression',
  'ArrayExpression',
  'ArrowFunctionExpression',
  'FunctionExpression',
  'Identifier',
  'MemberExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
]);

const ALLOWED_CALLEES = new Set([
  'loggerFactory',
  'express.Router',
  'Router',
  'Buffer.from',
]);

const calleeSource = (callee) => {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const objectSource = calleeSource(callee.object);
    return objectSource == null
      ? null
      : `${objectSource}.${callee.property.name}`;
  }
  return null;
};

const isAllowedInit = (init) => {
  if (init == null) return true;
  if (ALLOWED_INIT_TYPES.has(init.type)) return true;
  if (init.type === 'CallExpression') {
    const callee = calleeSource(init.callee);
    return callee != null && ALLOWED_CALLEES.has(callee);
  }
  return false;
};

const lineOf = (node) => (node.loc ? node.loc.start.line : 0);

/**
 * Collect guard violations for a single source file.
 *
 * @param {string} source file contents
 * @param {string} filename used in violation records
 * @returns {{ file: string, line: number, rule: string, detail: string }[]}
 */
const collectViolations = (source, filename) => {
  const violations = [];
  let root;
  try {
    root = j(source);
  } catch (e) {
    return [
      { file: filename, line: 0, rule: 'parse-error', detail: String(e) },
    ];
  }

  // --- CJS regression guard (whole file, any depth) ---
  root
    .find(j.CallExpression, { callee: { type: 'Identifier', name: 'require' } })
    .forEach((p) => {
      violations.push({
        file: filename,
        line: lineOf(p.node),
        rule: 'cjs-require',
        detail: 'require() is forbidden in route modules (Req 2.3)',
      });
    });
  root.find(j.MemberExpression).forEach((p) => {
    const src = calleeSource(p.node);
    if (src === 'module.exports') {
      violations.push({
        file: filename,
        line: lineOf(p.node),
        rule: 'cjs-module-exports',
        detail: 'module.exports is forbidden in route modules (Req 2.2)',
      });
    }
  });
  root.find(j.AssignmentExpression).forEach((p) => {
    const { left } = p.node;
    if (
      left.type === 'MemberExpression' &&
      left.object.type === 'Identifier' &&
      left.object.name === 'exports'
    ) {
      violations.push({
        file: filename,
        line: lineOf(p.node),
        rule: 'cjs-module-exports',
        detail: 'exports.<name> assignment is forbidden in route modules (Req 2.2)',
      });
    }
  });

  // --- top-level statement shape ---
  for (const stmt of root.get().node.program.body) {
    if (ALLOWED_STATEMENT_TYPES.has(stmt.type)) {
      const decl =
        stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : null;
      if (decl == null || decl.type !== 'VariableDeclaration') continue;
      checkVariableDeclaration(decl);
      continue;
    }
    if (stmt.type === 'VariableDeclaration') {
      checkVariableDeclaration(stmt);
      continue;
    }
    violations.push({
      file: filename,
      line: lineOf(stmt),
      rule: 'top-level-statement',
      detail: `top-level ${stmt.type} executes at import time — move it inside setup()`,
    });
  }

  function checkVariableDeclaration(decl) {
    for (const d of decl.declarations) {
      if (isAllowedInit(d.init)) continue;
      violations.push({
        file: filename,
        line: lineOf(d),
        rule: 'top-level-call',
        detail: `top-level initializer ${d.init.type} is not on the allowlist — move it inside setup()`,
      });
    }
  }

  return violations;
};

const collectTargetFiles = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTargetFiles(full));
      continue;
    }
    if (!/\.(js|ts)$/.test(entry.name)) continue;
    if (/\.(spec|integ)\.(js|ts)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
};

const main = () => {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    process.stderr.write(
      'usage: node route-top-level-guard.cjs <dir> [...dirs]\n',
    );
    process.exit(2);
  }
  const violations = [];
  let fileCount = 0;
  for (const target of targets) {
    for (const file of collectTargetFiles(target)) {
      fileCount += 1;
      violations.push(
        ...collectViolations(fs.readFileSync(file, 'utf8'), file),
      );
    }
  }
  if (violations.length > 0) {
    for (const v of violations) {
      process.stderr.write(`${v.file}:${v.line} [${v.rule}] ${v.detail}\n`);
    }
    process.stderr.write(
      `route-top-level-guard: ${violations.length} violation(s) in ${fileCount} file(s)\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `route-top-level-guard: OK (${fileCount} files checked)\n`,
  );
};

module.exports = { collectViolations };

if (require.main === module) {
  main();
}
