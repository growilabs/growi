/**
 * @typedef {import('eslint').Rule} Rule
 * @typedef {import('./lib/html.js').HtmlOptions} HtmlOptions
 */

/** @type {Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
  },
  /**
   * @property {Rule.RuleContext} context
   * @return {Rule.RuleListener}
   */
  create: (context) => {
    return {
      CallExpression(node) {
        if (node.callee.property && node.callee.property.name === 'populate') {
          context.report({
            node,
            message:
              "The 'populate' method should not be called in model modules.",
          });
        }
      },
    };
  },
};
