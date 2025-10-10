/**
 * @type {import('eslint').Linter.Config}
 */
module.exports = {
  extends: [
    'next/core-web-vitals',
    'weseek/react',
  ],
  plugins: [
  ],
  ignorePatterns: [
    'dist/**',
    '**/dist/**',
    'transpiled/**',
    'public/**',
    'src/linter-checker/**',
    'tmp/**',
    'next-env.d.ts',
    'next.config.js',
    'playwright.config.ts',
    'test/integration/global-setup.js',
    'test/integration/global-teardown.js',
    'test/integration/setup-crowi.ts',
    'test/integration/crowi/**',
    'test/integration/middlewares/**',
    'test/integration/migrations/**',
    'test/integration/models/**',
    'test/integration/service/**',
    'test/integration/setup.js',
    'test-with-vite/**',
    'public/**',
    'bin/**',
    'config/**',
    'src/styles/**',
    'src/linter-checker/**',
    'src/migrations/**',
    'src/models/**',
    'src/features/callout/**',
    'src/features/comment/**',
    'src/features/templates/**',
    'src/features/mermaid/**',
    'src/features/search/**',
    'src/features/plantuml/**',
    'src/features/external-user-group/**',
    'src/features/page-bulk-export/**',
    'src/features/growi-plugin/**',
    'src/features/opentelemetry/**',
    'src/features/rate-limiter/**',
    'src/stores-universal/**',
    'src/interfaces/**',
    'src/utils/**',
    'src/services/**',
  ],
  settings: {
    // resolve path aliases by eslint-import-resolver-typescript
    'import/resolver': {
      typescript: {},
    },
  },
  rules: {
    'no-restricted-imports': ['error', {
      name: 'axios',
      message: 'Please use src/utils/axios instead.',
    }],
    '@typescript-eslint/no-var-requires': 'off',

    // set 'warn' temporarily -- 2021.08.02 Yuki Takei
    '@typescript-eslint/no-use-before-define': ['warn'],
    '@typescript-eslint/no-this-alias': ['warn'],
  },
  overrides: [
    {
      // enable the rule specifically for JavaScript files
      files: ['*.js', '*.mjs', '*.jsx'],
      rules: {
        // set 'warn' temporarily -- 2023.08.14 Yuki Takei
        'react/prop-types': 'warn',
        // set 'warn' temporarily -- 2023.08.14 Yuki Takei
        'no-unused-vars': ['warn'],
      },
    },
    {
      // enable the rule specifically for TypeScript files
      files: ['*.ts', '*.mts', '*.tsx'],
      rules: {
        'no-unused-vars': 'off',
        // set 'warn' temporarily -- 2023.08.14 Yuki Takei
        'react/prop-types': 'warn',
        // set 'warn' temporarily -- 2022.07.25 Yuki Takei
        '@typescript-eslint/explicit-module-boundary-types': ['warn'],
      },
    },
  ],
};
