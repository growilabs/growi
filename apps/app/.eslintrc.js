module.exports = {
  extends: [
    'next/core-web-vitals',
    'weseek/react',
  ],
  plugins: [
    'regex',
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
    'regex/invalid': ['error', [
      {
        regex: '\\?\\<\\!',
        message: 'Do not use any negative lookbehind',
      }, {
        regex: '\\?\\<\\=',
        message: 'Do not use any Positive lookbehind',
      },
    ]],
    '@typescript-eslint/no-var-requires': 'off',

    // set 'warn' temporarily -- 2021.08.02 Yuki Takei
    '@typescript-eslint/no-use-before-define': ['warn'],
    '@typescript-eslint/no-this-alias': ['warn'],
  },
  overrides: [
    {
      // enable the rule specifically for JavaScript files
      files: ['*.js', '*.jsx'],
      rules: {
        // set 'warn' temporarily -- 2023.08.14 Yuki Takei
        'react/prop-types': 'warn',
        // set 'warn' temporarily -- 2023.08.14 Yuki Takei
        'no-unused-vars': ['warn'],
      },
    },
    {
      // enable the rule specifically for TypeScript files
      files: ['*.ts', '*.tsx'],
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
