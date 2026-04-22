/**
 * jscodeshift transform: CJS → ESM
 *
 * Handles 8 CJS patterns in apps/app/src/server/ :
 *   P1: module.exports = ... → export const setup / export default
 *   P2: const x = require('./x') → import x from './x'
 *   P3: require('./x')(crowi, app) factory invoke → import { setup } + invoke
 *   P4: ternary × factory invoke (non-async enclosing, transforms each branch)
 *   P5: const { x } = require('pkg') → import { x } from 'pkg'
 *   P6: require('pkg').member → import { member } from 'pkg'
 *   P7: require(dynamicVar)(ctx) → (await import(dynamicVar)).default(ctx)
 *   P8: exclusion list — intentional lazy requires must not be transformed
 *
 * Also rewrites /config/{migrate-mongo,next-i18next,i18next}-config specifiers
 * to add .cjs extension.
 *
 * CLI wrapper: called by `pnpm codemod:cjs-to-esm -- <path>`
 */

'use strict';

// ─── Exclusion list ──────────────────────────────────────────────────────────
// Each entry describes a file + a string marker that identifies the intentional
// lazy require. When a require() call is found inside a function whose name or
// surrounding code contains the marker, AND the file path matches, skip it.
const EXCLUSION_LIST = [
  // crowi/index.ts:500 — setupMailer: MailService = require('~/server/service/mail').default
  // This is an intentional cycle-breaker lazy load.
  {
    filePattern: /crowi\/index\.ts$/,
    requireSpecifier: '~/server/service/mail',
  },
];

/**
 * Returns true if this require() call is in the exclusion list.
 * @param {string} filePath - The file being transformed
 * @param {string} specifier - The require() argument string
 */
function isExcluded(filePath, specifier) {
  return EXCLUSION_LIST.some(
    entry =>
      entry.filePattern.test(filePath) &&
      entry.requireSpecifier === specifier,
  );
}

// ─── Config specifier patterns ───────────────────────────────────────────────
const CONFIG_SPECIFIER_RE =
  /^(~\/config\/(?:migrate-mongo-config|next-i18next\.config|i18next\.config))$/;

/**
 * Rewrite a config specifier to add .cjs if it matches and doesn't already have it.
 */
function rewriteConfigSpecifier(specifier) {
  if (!CONFIG_SPECIFIER_RE.test(specifier)) return null;
  if (specifier.endsWith('.cjs')) return null;
  return specifier + '.cjs';
}

// ─── Helper: derive a camelCase import alias from a module specifier ─────────
function aliasFromSpecifier(specifier) {
  // Take the last path segment, strip extension, camelCase it
  const base = specifier
    .replace(/\.js$|\.ts$|\.cjs$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || 'module';

  // Convert kebab-case / snake_case to camelCase
  return base.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

// ─── Main transform ──────────────────────────────────────────────────────────

/**
 * @param {object} fileInfo
 * @param {object} api
 * @param {object} _options
 * @returns {string|undefined}
 */
module.exports = function transform(fileInfo, api, _options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const filePath = fileInfo.path || '';

  let changed = false;

  // Track imports to add at the top (avoid duplicates)
  const pendingImports = new Map(); // specifier → Set of local names or null (default)

  function addDefaultImport(localName, specifier) {
    if (!pendingImports.has(specifier)) {
      pendingImports.set(specifier, { kind: 'default', localName });
    }
    changed = true;
  }

  function addNamedImport(importedName, localName, specifier) {
    const key = specifier;
    if (!pendingImports.has(key)) {
      pendingImports.set(key, { kind: 'named', members: [] });
    }
    const entry = pendingImports.get(key);
    if (entry.kind === 'named') {
      // Avoid duplicate members
      const exists = entry.members.some(m => m.importedName === importedName);
      if (!exists) {
        entry.members.push({ importedName, localName });
      }
    }
    changed = true;
  }

  // ─── Rewrite existing import specifiers for config .cjs ─────────────────
  root.find(j.ImportDeclaration).forEach(path => {
    const spec = path.node.source.value;
    const newSpec = rewriteConfigSpecifier(spec);
    if (newSpec) {
      path.node.source.value = newSpec;
      changed = true;
    }
  });

  // ─── P8: check if we should skip the whole file ───────────────────────────
  // (We do exclusion per-node below; no whole-file skip needed)

  // ─── P5: const { x, y } = require('pkg') → import { x, y } from 'pkg' ───
  root.find(j.VariableDeclaration).filter(path => {
    const decl = path.node.declarations;
    return (
      decl.length === 1 &&
      decl[0].id.type === 'ObjectPattern' &&
      decl[0].init &&
      decl[0].init.type === 'CallExpression' &&
      decl[0].init.callee.type === 'Identifier' &&
      decl[0].init.callee.name === 'require' &&
      decl[0].init.arguments.length === 1 &&
      decl[0].init.arguments[0].type === 'StringLiteral'
    );
  }).forEach(path => {
    const decl = path.node.declarations[0];
    const specifier = decl.init.arguments[0].value;

    // Exclusion check
    if (isExcluded(filePath, specifier)) return;

    // Config specifier rewrite
    const finalSpecifier = rewriteConfigSpecifier(specifier) || specifier;

    const properties = decl.id.properties;
    const specifiers = properties.map(prop => {
      const importedName =
        prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
      const localName =
        prop.value.type === 'Identifier' ? prop.value.name : importedName;
      if (importedName === localName) {
        return j.importSpecifier(j.identifier(importedName));
      }
      return j.importSpecifier(
        j.identifier(importedName),
        j.identifier(localName),
      );
    });

    const importDecl = j.importDeclaration(
      specifiers,
      j.stringLiteral(finalSpecifier),
    );
    j(path).replaceWith(importDecl);
    changed = true;
  });

  // ─── P6: const x = require('pkg').member ─────────────────────────────────
  // Matches: const localName = require('pkg').memberName;
  // Converts to: import { memberName as localName } from 'pkg';
  //              (or just import { memberName } if names match, i.e. localName = memberName usage)
  //
  // Also handles inline call: const x = require('pkg').member(args);
  // In that case: import { member } from 'pkg'; const x = member(args);
  root.find(j.VariableDeclaration).filter(path => {
    const decl = path.node.declarations;
    return (
      decl.length === 1 &&
      decl[0].id.type === 'Identifier' &&
      decl[0].init &&
      decl[0].init.type === 'MemberExpression' &&
      decl[0].init.object.type === 'CallExpression' &&
      decl[0].init.object.callee.type === 'Identifier' &&
      decl[0].init.object.callee.name === 'require' &&
      decl[0].init.object.arguments.length === 1 &&
      decl[0].init.object.arguments[0].type === 'StringLiteral'
    );
  }).forEach(path => {
    const decl = path.node.declarations[0];
    const requireCall = decl.init.object;
    const memberExpr = decl.init;
    const specifier = requireCall.arguments[0].value;
    const localName = decl.id.name;

    // Exclusion check
    if (isExcluded(filePath, specifier)) return;

    const memberName =
      memberExpr.property.type === 'Identifier'
        ? memberExpr.property.name
        : memberExpr.property.value;

    const finalSpecifier = rewriteConfigSpecifier(specifier) || specifier;

    // import { memberName as localName } from 'pkg';
    const specifierNode =
      memberName === localName
        ? j.importSpecifier(j.identifier(memberName))
        : j.importSpecifier(j.identifier(memberName), j.identifier(localName));

    const importDecl = j.importDeclaration(
      [specifierNode],
      j.stringLiteral(finalSpecifier),
    );
    j(path).replaceWith(importDecl);
    changed = true;
  });

  // Handle: const x = require('pkg').member(args);  (member call pattern)
  root.find(j.VariableDeclaration).filter(path => {
    const decl = path.node.declarations;
    return (
      decl.length === 1 &&
      decl[0].id.type === 'Identifier' &&
      decl[0].init &&
      decl[0].init.type === 'CallExpression' &&
      decl[0].init.callee.type === 'MemberExpression' &&
      decl[0].init.callee.object.type === 'CallExpression' &&
      decl[0].init.callee.object.callee.type === 'Identifier' &&
      decl[0].init.callee.object.callee.name === 'require' &&
      decl[0].init.callee.object.arguments.length === 1 &&
      decl[0].init.callee.object.arguments[0].type === 'StringLiteral'
    );
  }).forEach(path => {
    const decl = path.node.declarations[0];
    const requireCall = decl.init.callee.object;
    const memberExpr = decl.init.callee;
    const specifier = requireCall.arguments[0].value;
    const localName = decl.id.name;

    // Exclusion check
    if (isExcluded(filePath, specifier)) return;

    const memberName =
      memberExpr.property.type === 'Identifier'
        ? memberExpr.property.name
        : memberExpr.property.value;

    const finalSpecifier = rewriteConfigSpecifier(specifier) || specifier;

    // Build: import { memberName } from 'pkg';
    const importDecl = j.importDeclaration(
      [j.importSpecifier(j.identifier(memberName))],
      j.stringLiteral(finalSpecifier),
    );

    // Build: const localName = memberName(args);
    const newInit = j.callExpression(
      j.identifier(memberName),
      decl.init.arguments,
    );
    const newDecl = j.variableDeclaration('const', [
      j.variableDeclarator(j.identifier(localName), newInit),
    ]);

    // Replace the single VariableDeclaration with import + new declaration.
    // Use path.replace (recast NodePath API) to avoid a blank line between nodes.
    path.replace(importDecl, newDecl);
    changed = true;
  });

  // ─── P3 + P4: factory invoke require('./x')(args) ────────────────────────
  // This handles BOTH:
  //   - const x = require('./x')(crowi, app);  (P3)
  //   - ...ternary ? a : require('./x')(crowi) (P4)
  //   - router.use('/x', require('./x')(crowi)) (P3 inline)
  // Strategy: find all CallExpression where callee is require(string) call,
  // then replace the whole CallExpression with a call to setupXxx,
  // and hoist an import { setup as setupXxx } before the statement.

  // We need to collect all factory-require call expressions, deduplicate by specifier,
  // and emit imports at the top.

  const factoryRequireCalls = root.find(j.CallExpression).filter(path => {
    const callee = path.node.callee;
    return (
      callee.type === 'CallExpression' &&
      callee.callee.type === 'Identifier' &&
      callee.callee.name === 'require' &&
      callee.arguments.length === 1 &&
      callee.arguments[0].type === 'StringLiteral'
    );
  });

  // Group by specifier to build imports
  const factorySpecifiers = new Set();
  factoryRequireCalls.forEach(path => {
    const specifier = path.node.callee.arguments[0].value;
    if (!isExcluded(filePath, specifier)) {
      factorySpecifiers.add(specifier);
    }
  });

  // Replace each factory call: require('./x')(args) → setupX(args)
  factoryRequireCalls.forEach(path => {
    const specifier = path.node.callee.arguments[0].value;
    if (isExcluded(filePath, specifier)) return;

    const alias = aliasFromSpecifier(specifier);
    const setupName = `setup${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;

    // Replace require('./x')(args) with setupX(args)
    j(path).replaceWith(
      j.callExpression(j.identifier(setupName), path.node.arguments),
    );
    changed = true;
  });

  // Now collect distinct specifiers and add imports
  // We need to find which specifiers are used and add their imports
  // We build a map from specifier → setupName
  const factoryImports = new Map();
  factorySpecifiers.forEach(specifier => {
    const alias = aliasFromSpecifier(specifier);
    const setupName = `setup${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
    factoryImports.set(specifier, setupName);
  });

  // ─── P2: const x = require('./x') (non-destructuring, non-factory) ────────
  // These are the remaining require() calls that are simple default imports
  root.find(j.VariableDeclaration).filter(path => {
    const decl = path.node.declarations;
    return (
      decl.length === 1 &&
      decl[0].id.type === 'Identifier' &&
      decl[0].init &&
      decl[0].init.type === 'CallExpression' &&
      decl[0].init.callee.type === 'Identifier' &&
      decl[0].init.callee.name === 'require' &&
      decl[0].init.arguments.length === 1 &&
      decl[0].init.arguments[0].type === 'StringLiteral'
    );
  }).forEach(path => {
    const decl = path.node.declarations[0];
    const specifier = decl.init.arguments[0].value;
    const localName = decl.id.name;

    // Exclusion check
    if (isExcluded(filePath, specifier)) return;

    const finalSpecifier = rewriteConfigSpecifier(specifier) || specifier;

    const importDecl = j.importDeclaration(
      [j.importDefaultSpecifier(j.identifier(localName))],
      j.stringLiteral(finalSpecifier),
    );
    j(path).replaceWith(importDecl);
    changed = true;
  });

  // ─── P7: require(dynamicExpr)(args) → (await import(dynamicExpr)).default(args) ──
  // Matches CallExpression where callee is a CallExpression with identifier 'require'
  // but argument is NOT a StringLiteral (dynamic).
  root.find(j.CallExpression).filter(path => {
    const callee = path.node.callee;
    return (
      callee.type === 'CallExpression' &&
      callee.callee.type === 'Identifier' &&
      callee.callee.name === 'require' &&
      callee.arguments.length === 1 &&
      callee.arguments[0].type !== 'StringLiteral' // dynamic
    );
  }).forEach(path => {
    const dynamicArg = path.node.callee.arguments[0];
    const callArgs = path.node.arguments;

    // (await import(dynamicArg)).default ?? (await import(dynamicArg))
    // Then call it with the original args
    const awaitImport = j.awaitExpression(
      j.callExpression(j.import(), [dynamicArg]),
    );
    const awaitImport2 = j.awaitExpression(
      j.callExpression(j.import(), [dynamicArg]),
    );

    const defaultOrModule = j.logicalExpression(
      '??',
      j.memberExpression(awaitImport, j.identifier('default')),
      awaitImport2,
    );

    const newCall = j.callExpression(
      j.parenthesizedExpression
        ? j.parenthesizedExpression(defaultOrModule)
        : defaultOrModule,
      callArgs,
    );

    j(path).replaceWith(newCall);
    changed = true;
  });

  // ─── P1: module.exports = ... → export ───────────────────────────────────
  root.find(j.ExpressionStatement).filter(path => {
    const expr = path.node.expression;
    return (
      expr.type === 'AssignmentExpression' &&
      expr.left.type === 'MemberExpression' &&
      expr.left.object.type === 'Identifier' &&
      expr.left.object.name === 'module' &&
      expr.left.property.type === 'Identifier' &&
      expr.left.property.name === 'exports'
    );
  }).forEach(path => {
    const right = path.node.expression.right;

    if (
      right.type === 'ArrowFunctionExpression' ||
      right.type === 'FunctionExpression'
    ) {
      // module.exports = (crowi, app) => { ... }
      // → export const setup = (crowi, app) => { ... }
      const exportDecl = j.exportNamedDeclaration(
        j.variableDeclaration('const', [
          j.variableDeclarator(j.identifier('setup'), right),
        ]),
        [],
      );
      j(path).replaceWith(exportDecl);
    } else if (right.type === 'Identifier') {
      // module.exports = MyClass or module.exports = instance
      // → export default MyClass / export default instance
      const exportDefault = j.exportDefaultDeclaration(j.identifier(right.name));
      j(path).replaceWith(exportDefault);
    } else if (right.type === 'ClassDeclaration') {
      // module.exports = class Foo { }
      j(path).replaceWith(j.exportDefaultDeclaration(right));
    } else if (right.type === 'ClassExpression') {
      j(path).replaceWith(j.exportDefaultDeclaration(right));
    } else {
      // Fallback: export default <value>
      j(path).replaceWith(j.exportDefaultDeclaration(right));
    }
    changed = true;
  });

  // ─── Insert factory imports at the top of the file ───────────────────────
  if (factoryImports.size > 0) {
    const body = root.find(j.Program).get('body');
    const statements = body.value;

    // Find the last existing import declaration index
    let insertIdx = 0;
    for (let i = 0; i < statements.length; i++) {
      if (statements[i].type === 'ImportDeclaration') {
        insertIdx = i + 1;
      } else {
        break;
      }
    }

    const newImports = [];
    for (const [specifier, setupName] of factoryImports) {
      const finalSpecifier = rewriteConfigSpecifier(specifier) || specifier;
      const importDecl = j.importDeclaration(
        [
          j.importSpecifier(
            j.identifier('setup'),
            j.identifier(setupName),
          ),
        ],
        j.stringLiteral(finalSpecifier),
      );
      newImports.push(importDecl);
    }

    statements.splice(insertIdx, 0, ...newImports);
    changed = true;
  }

  if (!changed) return undefined;
  return root.toSource({ quote: 'single' });
};

// ─── CLI entry point ─────────────────────────────────────────────────────────
// When run directly (not as a jscodeshift transform), provide a CLI wrapper
// that calls jscodeshift programmatically.
if (require.main === module) {
  const path = require('path');
  const { execFileSync } = require('child_process');

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node tools/codemod/cjs-to-esm.cjs <path> [<path> ...]');
    process.exit(1);
  }

  // Resolve all target paths to absolute
  const targetPaths = args.map(a => path.resolve(a));

  const jscodeshift = require.resolve('.bin/jscodeshift');
  const transformPath = __filename;

  try {
    execFileSync(
      process.execPath,
      [
        jscodeshift,
        '--transform',
        transformPath,
        '--extensions',
        'js,ts,jsx,tsx',
        '--parser',
        'ts',
        '--ignore-pattern',
        '**/node_modules/**',
        '--ignore-pattern',
        '**/src/migrations/**',
        ...targetPaths,
      ],
      { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') },
    );
  } catch {
    process.exit(1);
  }
}
