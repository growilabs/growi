/**
 * Post-build script for server compilation.
 *
 * tsc compiles both `src/` and `config/` (TypeScript files under config/),
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
 *
 * The config copy intentionally skips `.mjs` / `.cjs` (and their `.d.mts` /
 * `.d.cts` declarations): those config files are authored directly as native
 * ESM / CJS, are imported from `dist/` as-is at runtime (no transpilation
 * needed), and tsc only re-emits a reformatted copy of them. Copying that copy
 * back would overwrite the authored source with build-tool formatting.
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

// Copy compiled config files to app root config/ so runtime imports resolve.
// Skip native ESM/CJS config sources and their emitted declarations: those are
// authored directly under config/ and must not be overwritten by tspc output.
const PRESERVED_CONFIG_SUFFIXES = ['.mjs', '.cjs', '.d.mts', '.d.cts'];
if (existsSync(CONFIG_SUBDIR)) {
  cpSync(CONFIG_SUBDIR, 'config', {
    recursive: true,
    force: true,
    filter: (src) =>
      !PRESERVED_CONFIG_SUFFIXES.some((suffix) => src.endsWith(suffix)),
  });
}

// Remove leftover transpiled directory
rmSync(TRANSPILED_DIR, { recursive: true, force: true });

// Rewrite path-alias specifiers (~/, ^/) to relative form and add .js
// extensions to extensionless relative specifiers in dist. tsc (Bundler
// resolution) emits specifiers exactly as authored — aliases unrewritten and
// extensionless; Node native ESM resolves neither. add-js-extensions resolves
// each specifier against the real dist filesystem and rewrites it in place.
{
  // Explicit .ts specifier: postbuild-server.ts runs via `node bin/postbuild-server.ts`
  // (native type stripping), whose ESM resolution performs no extension search.
  const { addJsExtensions } = await import('./add-js-extensions.ts');
  const { resolve } = await import('node:path');
  const distRoot = resolve(DIST_DIR);
  // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
  console.log(`[postbuild] Running add-js-extensions on ${distRoot}...`);
  // Alias table = tsconfig.build.server.json `paths` projected onto the dist
  // layout: `~/*` → ./src/* (moved to dist/), `^/*` → ./* (the app root,
  // where transpiled/config/ was copied to config/ alongside dist/).
  const result = addJsExtensions(distRoot, [
    { prefix: '~/', targetDir: distRoot },
    { prefix: '^/', targetDir: resolve(distRoot, '..') },
  ]);
  // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
  console.log(
    `[postbuild] add-js-extensions: rewrote ${result.rewritten} specifier(s), unresolved: ${result.unresolved.length}`,
  );
  if (result.unresolved.length > 0) {
    // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
    console.error(
      '[postbuild] add-js-extensions: unresolved specifiers found (CI will fail at verify-dist-resolution):',
    );
    for (const u of result.unresolved) {
      // biome-ignore lint/suspicious/noConsole: This is a build script, console output is expected.
      console.error(`  ${u}`);
    }
  }
}

// Copy Prisma native engine binaries from src to dist.
// tsc only compiles TypeScript files, so .so.node engine files must be copied manually.
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
