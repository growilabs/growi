import { defineConfig } from 'i18next-cli';

// i18next-cli configuration for apps/app.
//
// This spec (i18n-key-audit) only ever invokes the read-only `status`
// command (see Requirement 5 / design.md "Audit Orchestrator") — `extract`
// and `sync` are never run against this config, so translation files under
// `public/static/locales/**` are never rewritten by this tooling.
export default defineConfig({
  // Locale directory names as they exist under public/static/locales/.
  // en_US is the primary (source-of-truth) language.
  locales: ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'],

  extract: {
    // Source files scanned for t()-style key usage.
    input: ['src/**/*.{ts,tsx,js,jsx}'],

    // Existing resource files this config points at. `status` reads from
    // this location; it never writes here because extract/sync are not run.
    output: 'public/static/locales/{{language}}/{{namespace}}.json',

    // Exclude test files: they are not real key usage and would otherwise
    // pollute both the "used keys" set (from calling t() in test fixtures)
    // and the unused-key count.
    ignore: [
      'node_modules/**',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.integ.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
    ],

    primaryLanguage: 'en_US',
    secondaryLanguages: ['ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'],
  },
});
