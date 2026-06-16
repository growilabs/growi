/**
 * Post-build tool: add-js-extensions (C1, esm-import-convention task 2.2).
 *
 * Rewrites extensionless relative import specifiers in emitted .js files so that
 * Node native ESM can resolve them. Called from postbuild-server.ts after
 * typescript-transform-paths has converted alias paths to relative form.
 *
 * Resolution rules (importer-dir-relative, only mutates extensionless relatives):
 *   ./X   → ./X.js        when dist/X.js exists
 *   ./X   → ./X.jsx       when dist/X.jsx exists (dead client emit from .tsx)
 *   ./dir → ./dir/index.js  when dist/dir/index.js exists
 *   ./dir → ./dir/index.jsx when dist/dir/index.jsx exists
 *   Already-extensioned (.js/.jsx/.cjs/.mjs/.json) → unchanged (idempotent)
 *   External (no leading ./ or ../) → unchanged
 *   Unresolvable → unchanged + warning (reported in unresolved[])
 *
 * @returns {{ rewritten: number, unresolved: string[] }}
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * @typedef {{ rewritten: number; unresolved: string[] }} AddJsExtensionsResult
 */

/**
 * Regex to match import/export from '...' and import('...') expressions.
 * Captures:
 *   group 1: prefix (from/import keyword + quote)
 *   group 2: the specifier string
 *   group 3: closing quote
 *
 * Handles both single and double quotes. Does not handle template literals
 * (dynamic imports with template literals are rare in TS/JS output).
 *
 * Applied only to non-comment lines — see processLine() below.
 */
const IMPORT_SPEC_RE = /(\bfrom\s*['"]|\bimport\(\s*['"]|\bimport\s*['"])(\.\.?\/[^'"]+)(['"]\s*(?:with\s*\{[^}]*\})?)/g;

/**
 * Regex to detect whether a line is purely a comment line (should be skipped).
 * Matches lines like:
 *   // comment
 *    * JSDoc line
 *    * @example import('./foo')
 */
const COMMENT_LINE_RE = /^\s*(\/\/|\*)/;

/**
 * Returns true if the specifier already has a file extension that should not
 * be further modified.
 *
 * @param {string} spec
 * @returns {boolean}
 */
function hasExtension(spec) {
  // Strip query string and fragment if any
  const bare = spec.split('?')[0].split('#')[0];
  // Remove trailing slash — ./dir/ is treated as a directory import
  const stripped = bare.endsWith('/') ? bare.slice(0, -1) : bare;
  return /\.[mc]?[jt]sx?$/.test(stripped) || /\.json$/.test(stripped) || /\.cjs$/.test(stripped) || /\.mjs$/.test(stripped);
}

/**
 * Resolve an extensionless specifier relative to `importerDir` in the dist
 * tree. Returns the rewritten specifier string or null if unresolvable.
 *
 * @param {string} importerDir  absolute path of the directory containing the importer
 * @param {string} spec         the raw specifier value (e.g. './foo' or '../bar')
 * @returns {string | null}  rewritten specifier or null
 */
function resolveSpec(importerDir, spec) {
  // Strip trailing slash to normalise directory imports
  const normalised = spec.endsWith('/') ? spec.slice(0, -1) : spec;
  const abs = resolve(importerDir, normalised);

  // 1. Direct file candidates: X.js then X.jsx
  for (const ext of ['.js', '.jsx']) {
    if (existsSync(abs + ext)) {
      return normalised + ext;
    }
  }

  // 2. Directory index candidates: dir/index.js then dir/index.jsx
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    for (const idx of ['index.js', 'index.jsx']) {
      const candidate = join(abs, idx);
      if (existsSync(candidate)) {
        return normalised + '/' + idx;
      }
    }
  }

  return null;
}

/**
 * Walk `dir` recursively and collect all .js file paths.
 *
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]}
 */
function walkJs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJs(p, acc);
    } else if (entry.isFile() && p.endsWith('.js')) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * Main entry point. Processes all .js files under `distRoot`, rewriting
 * extensionless relative import specifiers to the resolved form.
 *
 * @param {string} distRoot  absolute path to the dist directory
 * @returns {AddJsExtensionsResult}
 */
export function addJsExtensions(distRoot) {
  let rewritten = 0;
  /** @type {string[]} */
  const unresolved = [];

  for (const file of walkJs(distRoot)) {
    const importerDir = dirname(file);
    const original = readFileSync(file, 'utf8');

    // Process line by line so that comment lines (// ... and * JSDoc lines)
    // are skipped and their content is never modified.
    const lines = original.split('\n');
    const processedLines = lines.map((line) => {
      // Skip pure comment lines (// and * JSDoc lines) — they may contain
      // example code like import('./MyModal') that should not be resolved.
      if (COMMENT_LINE_RE.test(line)) {
        return line;
      }

      return line.replace(
        IMPORT_SPEC_RE,
        (match, prefix, spec, suffix) => {
          // Already extensioned — leave untouched
          if (hasExtension(spec)) {
            return match;
          }

          const resolved = resolveSpec(importerDir, spec);
          if (resolved == null) {
            const location = `${file}: '${spec}'`;
            unresolved.push(location);
            // biome-ignore lint/suspicious/noConsole: build script diagnostic
            console.warn(`[add-js-extensions] unresolvable: ${location}`);
            return match;
          }

          if (resolved === spec) {
            return match;
          }

          rewritten += 1;
          return prefix + resolved + suffix;
        },
      );
    });

    const rewrittenContent = processedLines.join('\n');
    if (rewrittenContent !== original) {
      writeFileSync(file, rewrittenContent, 'utf8');
    }
  }

  return { rewritten, unresolved };
}

// Allow direct CLI invocation: node add-js-extensions.mjs <distRoot>
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const distRoot = process.argv[2];
  if (!distRoot) {
    // biome-ignore lint/suspicious/noConsole: build script diagnostic
    console.error('Usage: node add-js-extensions.mjs <distRoot>');
    process.exit(1);
  }
  const result = addJsExtensions(distRoot);
  // biome-ignore lint/suspicious/noConsole: build script summary
  console.log(
    `[add-js-extensions] rewrote ${result.rewritten} specifier(s), unresolved: ${result.unresolved.length}`,
  );
  if (result.unresolved.length > 0) {
    process.exit(1);
  }
}
