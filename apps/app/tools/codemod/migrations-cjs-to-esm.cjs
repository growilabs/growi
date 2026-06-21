/**
 * jscodeshift transform: convert migrate-mongo migration modules from the
 * mixed-CJS authoring style to native ESM with NAMED `up`/`down` exports.
 *
 * Background (esm-migration task 3.8.b fix): migrate-mongo loads each migration
 * and reads `migration.up` / `migration.down` directly off the loaded module
 * (lib/actions/up.js, down.js). Under ESM that requires NAMED exports — a
 * `export default { up, down }` would leave `migration.up` undefined. The
 * legacy migrations used `module.exports = { async up(){}, async down(){} }`
 * plus a mix of `import` and `const x = require('pkg')`, which only worked
 * because tsc compiled them to CommonJS. Once migrations are compiled as ESM
 * (their CJS isolation is dissolved), those CJS constructs must become ESM.
 *
 * Transforms (idempotent):
 *   - `const x = require('pkg')`            -> `import x from 'pkg'`
 *   - `const { a, b } = require('pkg')`     -> `import { a, b } from 'pkg'`
 *   - `module.exports = { async up(){…}, async down(){…} }`
 *        -> `export async function up(){…}` + `export async function down(){…}`
 *      (object methods, function-expression values and arrow values are all
 *       lifted to named function declarations; non-function values become
 *       `export const <key> = <value>`)
 *
 * Bare-package require specifiers (e.g. 'mongoose') need no extension; relative
 * and alias specifiers are handled by the separate add-import-extensions pass.
 */

'use strict';

/** @type {import('jscodeshift').Transform} */
module.exports = function transform(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let mutated = false;

  // 1) `const x = require('pkg')` / `const { a } = require('pkg')` -> import
  root
    .find(j.VariableDeclaration)
    .filter((path) => {
      const decls = path.node.declarations;
      if (decls.length !== 1) return false;
      const init = decls[0].init;
      return (
        init != null &&
        init.type === 'CallExpression' &&
        init.callee.type === 'Identifier' &&
        init.callee.name === 'require' &&
        init.arguments.length === 1 &&
        (init.arguments[0].type === 'StringLiteral' ||
          init.arguments[0].type === 'Literal') &&
        typeof init.arguments[0].value === 'string'
      );
    })
    .forEach((path) => {
      const decl = path.node.declarations[0];
      const source = j.literal(decl.init.arguments[0].value);
      let specifiers;
      if (decl.id.type === 'Identifier') {
        specifiers = [j.importDefaultSpecifier(j.identifier(decl.id.name))];
      } else if (decl.id.type === 'ObjectPattern') {
        specifiers = decl.id.properties.map((p) =>
          j.importSpecifier(
            j.identifier(p.key.name),
            j.identifier(p.value.name),
          ),
        );
      } else {
        return; // unsupported shape, leave as-is
      }
      j(path).replaceWith(j.importDeclaration(specifiers, source));
      mutated = true;
    });

  // 2) `module.exports = { up, down, ... }` -> named exports
  root
    .find(j.ExpressionStatement, {
      expression: {
        type: 'AssignmentExpression',
        left: {
          type: 'MemberExpression',
          object: { name: 'module' },
          property: { name: 'exports' },
        },
        right: { type: 'ObjectExpression' },
      },
    })
    .forEach((path) => {
      const props = path.node.expression.right.properties;
      const exportNodes = props.map((prop) => {
        const key = prop.key;
        const name = key.name ?? key.value;

        // `async up() {}` (ObjectMethod) or `up: function(){}` / `up: () => {}`
        const fn =
          prop.type === 'ObjectMethod' || prop.type === 'Property'
            ? prop.type === 'ObjectMethod'
              ? prop
              : prop.value
            : null;

        if (
          fn != null &&
          (fn.type === 'ObjectMethod' ||
            fn.type === 'FunctionExpression' ||
            fn.type === 'ArrowFunctionExpression')
        ) {
          const body =
            fn.body.type === 'BlockStatement'
              ? fn.body
              : j.blockStatement([j.returnStatement(fn.body)]);
          const fnDecl = j.functionDeclaration(
            j.identifier(name),
            fn.params,
            body,
          );
          fnDecl.async = fn.async ?? false;
          fnDecl.generator = fn.generator ?? false;
          return j.exportNamedDeclaration(fnDecl, []);
        }

        // Non-function value -> `export const <name> = <value>`
        const value = prop.value ?? prop;
        return j.exportNamedDeclaration(
          j.variableDeclaration('const', [
            j.variableDeclarator(j.identifier(name), value),
          ]),
          [],
        );
      });
      j(path).replaceWith(exportNodes);
      mutated = true;
    });

  return mutated ? root.toSource({ quote: 'single' }) : null;
};
