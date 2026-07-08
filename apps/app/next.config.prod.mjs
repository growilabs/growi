/**
 * Minimal Next.js config for production runtime.
 *
 * next.config.ts is the authoritative config used at build time (Turbopack rules,
 * transpilePackages, sassOptions, etc.).  However, Next.js 16 tries to transpile
 * .ts configs at server startup, which fails in production where TypeScript is not
 * installed.  assemble-prod.sh therefore deletes next.config.ts and renames this
 * file to next.config.js so the production server can load the runtime-critical
 * settings (i18n routing, pageExtensions, …) without a TypeScript toolchain.
 *
 * ESM syntax: apps/app declares `"type": "module"` (esm-migration task 3.6),
 * so the copied next.config.js is interpreted as an ES module.
 *
 * Keep the runtime-relevant values in sync with next.config.ts.
 */

import nextI18nConfig from './config/next-i18next.config.mjs';

const { i18n } = nextI18nConfig;

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],
  i18n,

  serverExternalPackages: ['handsontable'],
};
