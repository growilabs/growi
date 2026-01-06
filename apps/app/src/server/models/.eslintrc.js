const rulesDirPlugin = require('eslint-plugin-rulesdir');

rulesDirPlugin.RULES_DIR = 'src/server/models/eslint-rules-dir';

module.exports = {
  plugins: ['rulesdir'],
  rules: {
    'rulesdir/no-populate': 'warn',
  },
};
