/**
 * == Notes for production build==
 * The modules required from this file must be transpiled before running `next build`.
 *
 * See: https://github.com/vercel/next.js/discussions/35969#discussioncomment-2522954
 */

import type { NextConfig } from 'next';
import path from 'node:path';

import nextI18nConfig from './config/next-i18next.config.cjs';
import { listPrefixedPackages } from './src/utils/next.config.utils';

const { i18n } = nextI18nConfig;

const getTranspilePackages = (): string[] => {
  const packages = [
    // listing ESM packages until experimental.esmExternals works correctly to avoid ERR_REQUIRE_ESM
    'react-markdown',
    'unified',
    'markdown-table',
    'bail',
    'ccount',
    'character-entities',
    'character-entities-html4',
    'character-entities-legacy',
    'comma-separated-tokens',
    'decode-named-character-reference',
    'devlop',
    'fault',
    'hastscript',
    'html-void-elements',
    'is-absolute-url',
    'is-plain-obj',
    'longest-streak',
    'micromark',
    'property-information',
    'space-separated-tokens',
    'stringify-entities',
    'trim-lines',
    'trough',
    'web-namespaces',
    'vfile',
    'vfile-location',
    'vfile-message',
    'zwitch',
    'emoticon',
    'direction', // for hast-util-select
    'bcp-47-match', // for hast-util-select
    'parse-entities',
    'character-reference-invalid',
    'is-hexadecimal',
    'is-alphabetical',
    'is-alphanumerical',
    'github-slugger',
    'html-url-attributes',
    'estree-util-is-identifier-name',
    'superjson',
    ...listPrefixedPackages([
      'remark-',
      'rehype-',
      'hast-',
      'mdast-',
      'micromark-',
      'unist-',
    ]),
  ];

  return packages;
};

const optimizePackageImports: string[] = [
  '@growi/core',
  '@growi/editor',
  '@growi/pluginkit',
  '@growi/presentation',
  '@growi/preset-themes',
  '@growi/remark-attachment-refs',
  '@growi/remark-drawio',
  '@growi/remark-growi-directive',
  '@growi/remark-lsx',
  '@growi/slack',
  '@growi/ui',
];

// This config is used at build time only (next build / next dev).
// Production runtime uses next.config.prod.cjs (installed as next.config.js by assemble-prod.sh).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],
  i18n,

  serverExternalPackages: [
    'handsontable', // Legacy v6.2.2 requires @babel/polyfill which is unavailable; client-only via dynamic import
  ],

  // for build
  typescript: {
    tsconfigPath: 'tsconfig.build.client.json',
  },
  transpilePackages: getTranspilePackages(),
  sassOptions: {
    loadPaths: [path.resolve(__dirname, 'src')],
  },
  experimental: {
    optimizePackageImports,
  },

  turbopack: {
    rules: {
      // Server-only: auto-wrap getServerSideProps with SuperJSON serialization
      '*.page.ts': [
        {
          condition: { not: 'browser' },
          loaders: [
            path.resolve(__dirname, 'src/utils/superjson-ssr-loader.ts'),
          ],
          as: '*.ts',
        },
      ],
      '*.page.tsx': [
        {
          condition: { not: 'browser' },
          loaders: [
            path.resolve(__dirname, 'src/utils/superjson-ssr-loader.ts'),
          ],
          as: '*.tsx',
        },
      ],
    },
    resolveAlias: {
      // Exclude fs from client bundle
      fs: { browser: './src/lib/empty-module.ts' },
      // Exclude server-only packages from client bundle
      mongoose: { browser: './src/lib/empty-module.ts' },
      'i18next-fs-backend': { browser: './src/lib/empty-module.ts' },
      'core-js': { browser: './src/lib/empty-module.ts' },
    },
  },
};

export default nextConfig;
