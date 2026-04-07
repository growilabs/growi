/**
 * Post-build script for server compilation.
 *
 * tspc compiles both `src/` and `config/` (which will be migrated to TypeScript),
 * so the output directory (`transpiled/`) mirrors the source tree structure
 * (e.g. `transpiled/src/`, `transpiled/config/`).
 *
 * Setting `rootDir: "src"` and `outDir: "dist"` in tsconfig would eliminate this script,
 * but that would break once `config/` is included in the compilation.
 * Instead, this script extracts only `transpiled/src/` into `dist/` and discards the rest.
 */
import { readdirSync, renameSync, rmSync } from 'node:fs';

const TRANSPILED_DIR = 'transpiled';
const DIST_DIR = 'dist';
const SRC_SUBDIR = `${TRANSPILED_DIR}/src`;

// List transpiled contents for debugging
// biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
console.log('Listing files under transpiled:');
// biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
console.log(readdirSync(TRANSPILED_DIR).join('\n'));

// Remove old dist
rmSync(DIST_DIR, { recursive: true, force: true });

// Move transpiled/src -> dist
renameSync(SRC_SUBDIR, DIST_DIR);

// Remove leftover transpiled directory
rmSync(TRANSPILED_DIR, { recursive: true, force: true });
