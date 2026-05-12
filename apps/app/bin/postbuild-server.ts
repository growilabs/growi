/**
 * Post-build script for server compilation.
 *
 * tspc compiles both `src/` and `config/` (TypeScript files under config/),
 * so the output directory (`transpiled/`) mirrors the source tree structure
 * (e.g. `transpiled/src/`, `transpiled/config/`).
 *
 * Setting `rootDir: "src"` and `outDir: "dist"` in tsconfig would eliminate this script,
 * but that would break once `config/` is included in the compilation.
 *
 * This script:
 * 1. Extracts `transpiled/src/` into `dist/`
 * 2. Copies compiled `transpiled/config/` files into `config/` so that
 *    relative imports from `dist/` (e.g. `../../../config/logger/config.dev`)
 *    resolve correctly at runtime.
 */
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';

const TRANSPILED_DIR = 'transpiled';
const DIST_DIR = 'dist';
const SRC_SUBDIR = `${TRANSPILED_DIR}/src`;
const CONFIG_SUBDIR = `${TRANSPILED_DIR}/config`;
const PRISMA_SRC_DIR = 'src/generated/prisma';
const PRISMA_DIST_DIR = `${DIST_DIR}/generated/prisma`;

// List transpiled contents for debugging
// biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
console.log('Listing files under transpiled:');
// biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
console.log(readdirSync(TRANSPILED_DIR).join('\n'));

// Remove old dist
rmSync(DIST_DIR, { recursive: true, force: true });

// Move transpiled/src -> dist
renameSync(SRC_SUBDIR, DIST_DIR);

// Copy compiled config files to app root config/ so runtime imports resolve
if (existsSync(CONFIG_SUBDIR)) {
  cpSync(CONFIG_SUBDIR, 'config', { recursive: true, force: true });
}

// Remove leftover transpiled directory
rmSync(TRANSPILED_DIR, { recursive: true, force: true });

// Copy Prisma native engine binaries from src to dist.
// tspc only compiles TypeScript files, so .so.node engine files must be copied manually.
if (existsSync(PRISMA_SRC_DIR)) {
  // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
  console.log(
    `Copying Prisma engine files from ${PRISMA_SRC_DIR} to ${PRISMA_DIST_DIR}...`,
  );
  const engineFiles = readdirSync(PRISMA_SRC_DIR).filter((f) =>
    f.endsWith('.node'),
  );
  for (const file of engineFiles) {
    cpSync(`${PRISMA_SRC_DIR}/${file}`, `${PRISMA_DIST_DIR}/${file}`);
    // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
    console.log(`  Copied: ${file}`);
  }
}
