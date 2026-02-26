/**
 * == Notes for production build==
 * The modules required from this file must be transpiled before running `next build`.
 *
 * See: https://github.com/vercel/next.js/discussions/35969#discussioncomment-2522954
 */

import path from 'node:path';

import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';

import { createChunkModuleStatsPlugin, listPrefixedPackages } from './src/utils/next.config.utils';
import nextI18nConfig from './config/next-i18next.config';

const { i18n, localePath } = nextI18nConfig;

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
    'escape-string-regexp',
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

export default (phase: string): NextConfig => {
  /** @type {import('next').NextConfig} */
  const nextConfig: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],
    i18n,

    // Bundle server-side dependencies for Pages Router (Next.js 15+)
    // Matches App Router behavior: all deps are bundled except those in serverExternalPackages
    // Auto-excluded: mongoose, mongodb, express, sharp, and 68 other packages with native bindings
    bundlePagesRouterDependencies: true,
    serverExternalPackages: [
      'handsontable', // Legacy v6.2.2 requires @babel/polyfill which is unavailable; client-only via dynamic import
    ],

    // for build
    typescript: {
      tsconfigPath: 'tsconfig.build.client.json',
    },
    transpilePackages:
      phase !== PHASE_PRODUCTION_SERVER ? getTranspilePackages() : undefined,
    experimental: {
      optimizePackageImports,
    },

    webpack(config, options) {
      // Auto-wrap getServerSideProps with superjson serialization (replaces next-superjson SWC plugin)
      if (options.isServer) {
        config.module!.rules!.push({
          test: /\.page\.(tsx|ts)$/,
          use: [path.resolve(__dirname, 'src/utils/superjson-ssr-loader.ts')],
        });
      }

      if (!options.isServer) {
        // Avoid "Module not found: Can't resolve 'fs'"
        // See: https://stackoverflow.com/a/68511591
        config.resolve!.fallback = { ...config.resolve!.fallback, fs: false };

        // exclude packages from the output bundles
        config.module!.rules!.push(
          ...[
            /dtrace-provider/,
            /mongoose/,
            /mathjax-full/, // required from marp
            /i18next-fs-backend/, // server-only filesystem translation backend (leaks via next-i18next)
            /\/bunyan\//, // server-only logging (client uses browser-bunyan via universal-bunyan)
            /bunyan-format/, // server-only log formatter (client uses @browser-bunyan/console-formatted-stream)
            /[\\/]core-js[\\/]/, // polyfills baked into next-i18next/react-stickynode dist; all APIs natively supported by target browsers (Chrome 64+, Safari 12+)
          ].map((packageRegExp) => {
            return {
              test: packageRegExp,
              use: 'null-loader',
            };
          }),
        );
      }

      // extract sourcemap
      if (options.dev) {
        config.module!.rules!.push({
          test: /.(c|m)?js$/,
          exclude: [/node_modules/, path.resolve(__dirname)],
          enforce: 'pre',
          use: ['source-map-loader'],
        });
      }

      // setup i18next-hmr
      if (!options.isServer && options.dev) {
        // biome-ignore lint/suspicious/noRequireImports: lazy load dev-only plugin
        const { I18NextHMRPlugin } = require('i18next-hmr/webpack');
        config.plugins!.push(new I18NextHMRPlugin({ localesDir: localePath }));
      }

      // Log eager vs lazy module counts for dev compilation analysis
      if (!options.isServer && options.dev) {
        // biome-ignore lint/suspicious/noExplicitAny: webpack plugin type compatibility
        config.plugins!.push(createChunkModuleStatsPlugin() as any);
      }

      return config;
    },
  };

  // production server — skip bundle analyzer
  if (phase === PHASE_PRODUCTION_SERVER) {
    return nextConfig;
  }

  const withBundleAnalyzer = bundleAnalyzer({
    enabled:
      phase === PHASE_PRODUCTION_BUILD &&
      (process.env.ANALYZE === 'true' || process.env.ANALYZE === '1'),
  });

  return withBundleAnalyzer(nextConfig);
};
