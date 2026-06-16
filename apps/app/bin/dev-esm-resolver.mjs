/**
 * Dev/CI ESM resolver hook for running GROWI's TypeScript server from source
 * under Node's native type stripping (Node >= 24, enabled by default — no
 * `--experimental-*` flag). The project keeps its source erasable (no TS enum
 * or parameter properties), so Node strips types in-process with no external
 * transform tool (tsx / ts-node) involved.
 *
 * This hook only does *resolution* — it teaches Node's loader the project's
 * path aliases and the `.js`->`.ts` source mapping — so there is no per-module
 * transform cost beyond Node's own (the constant ESM-loader-hook round-trip
 * that made tsx ~2x slower on GROWI's large import fan-out; see
 * .kiro/specs/esm-migration/research.md "dev runner").
 *
 * Registered synchronously via `module.registerHooks` (no worker-thread round
 * trip). Used by the dev / migrate / repl scripts:
 *   node --import ./bin/dev-esm-resolver.mjs <entry>.ts
 *
 * Resolution rules (mirrors tsconfig.json `paths` + NodeNext `.js` specifiers):
 *   ~/x        -> <app>/src/x      (.ts/.tsx/.js/index.ts/...)
 *   ~/x.js     -> <app>/src/x.ts   (.js suffix -> .ts source)
 *   ^/x        -> <app>/x
 *   ./x.js     -> ./x.ts           (relative .js -> .ts source)
 *   ./dir      -> ./dir/index.ts   (directory -> index source)
 *   . / ..     -> ./index.ts / ../index.ts  (bare current/parent dir)
 * Other bare specifiers (packages) and anything already resolvable fall
 * through to the default.
 *
 * The bare `.` / `..` (and `./dir`) directory forms are produced by the
 * esm-import-convention codemod (which collapses `./index.js` -> `.`). Node's
 * native ESM loader rejects directory imports (ERR_UNSUPPORTED_DIR_IMPORT), so
 * this hook must resolve them to the directory's index source — mirroring the
 * production-side `bin/add-js-extensions.mjs`, which appends `/index.js` to the
 * same specifiers in the build output.
 */
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolvePath(HERE, '..');
const SRC = resolvePath(APP_ROOT, 'src');

// Candidate extensions, in resolution order (TS sources first).
const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Resolve an absolute path stem (possibly `.js`-suffixed or a directory) to a real source file. */
function resolveToFile(base) {
  if (isFile(base)) return base;
  // `.js`/`.cjs`/`.mjs` specifier -> the `.ts`/`.tsx`/... source on disk
  const jsExt = base.match(/\.(?:js|jsx|mjs|cjs)$/);
  const stem = jsExt ? base.slice(0, -jsExt[0].length) : base;
  for (const ext of EXTENSIONS) {
    if (isFile(stem + ext)) return stem + ext;
  }
  if (stem !== base) {
    for (const ext of EXTENSIONS) {
      if (isFile(base + ext)) return base + ext;
    }
  }
  for (const ext of EXTENSIONS) {
    const indexFile = resolvePath(base, `index${ext}`);
    if (isFile(indexFile)) return indexFile;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null;
    if (specifier.startsWith('~/')) {
      target = resolvePath(SRC, specifier.slice(2));
    } else if (specifier.startsWith('^/')) {
      target = resolvePath(APP_ROOT, specifier.slice(2));
    } else if (
      (specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('./') ||
        specifier.startsWith('../')) &&
      context.parentURL?.startsWith('file:')
    ) {
      target = resolvePath(
        dirname(fileURLToPath(context.parentURL)),
        specifier,
      );
    }

    if (target != null) {
      const file = resolveToFile(target);
      if (file != null) {
        return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
