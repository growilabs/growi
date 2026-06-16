/**
 * == Notes for production build==
 * The modules required from this file must be transpiled before running `next build`.
 *
 * See: https://github.com/vercel/next.js/discussions/35969#discussioncomment-2522954
 */

import type { NextConfig } from 'next';
import path from 'node:path';

import nextI18nConfig from './config/next-i18next.config.cjs';

const { i18n } = nextI18nConfig;

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
  // transpilePackages: all entries (40 hardcoded + 6 prefix groups) were removed during
  // the ESM migration (Phase 4). The unified/remark/rehype ecosystem and superjson are
  // ESM-only, but once apps/app became ESM, Turbopack resolves them natively without
  // transpilation, so none are needed. No entry remains for CJS/ESM incompatibility
  // reasons (Req 3.1-3.4 / 7.2; verified by build + production boot smoke + Phase 4 CI E2E).
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
