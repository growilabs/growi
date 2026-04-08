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
