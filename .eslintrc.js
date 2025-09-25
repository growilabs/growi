/**
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
  root: true, // https://eslint.org/docs/user-guide/configuring/configuration-files#cascading-and-hierarchy
  extends: [
    'weseek',
    'weseek/typescript',
  ],
  plugins: [
    'regex',
  ],
  ignorePatterns: [
    'node_modules/**',
  ],
  rules: {
    'import/prefer-default-export': 'off',
    'import/order': [
      'warn',
      {
        pathGroups: [
          {
            pattern: 'react',
            group: 'builtin',
            position: 'before',
          },
          {
            pattern: '^/**',
            group: 'parent',
            position: 'before',
          },
          {
            pattern: '~/**',
            group: 'parent',
            position: 'before',
          },
          {
            pattern: '*.css',
            group: 'type',
            patternOptions: { matchBase: true },
            position: 'after',
          },
          {
            pattern: '*.scss',
            group: 'type',
            patternOptions: { matchBase: true },
            position: 'after',
          },
        ],
        alphabetize: {
          order: 'asc',
        },
        pathGroupsExcludedImportTypes: ['react'],
        'newlines-between': 'always',
      },
    ],
    '@typescript-eslint/consistent-type-imports': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    indent: [
      'error',
      2,
      {
        SwitchCase: 1,
        ArrayExpression: 'first',
        FunctionDeclaration: { body: 1, parameters: 2 },
        FunctionExpression: { body: 1, parameters: 2 },
      },
    ],
    'regex/invalid': ['error', [
      {
        regex: '\\?\\<\\!',
        message: 'Do not use any negative lookbehind',
      }, {
        regex: '\\?\\<\\=',
        message: 'Do not use any Positive lookbehind',
      },
    ]],
  },
  overrides: [
    {
      // enable the rule specifically for TypeScript files
      files: ['*.ts', '*.mts', '*.tsx'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': ['error'],
      },
    },
  ],
};
