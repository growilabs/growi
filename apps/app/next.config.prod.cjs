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
 * Keep the runtime-relevant values in sync with next.config.ts.
 */

const nextI18nConfig = require('./config/next-i18next.config.cjs');

const { i18n } = nextI18nConfig;

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],
  i18n,

  serverExternalPackages: ['handsontable'],
};
