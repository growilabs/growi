/**
 * Post-build verification: verify-dist-resolution (C5, esm-import-convention task 3).
 *
 * Statically verifies that every relative import specifier in every emitted .js
 * file under distRoot points to a file that actually exists on disk.
 *
 * This recovers the "build-time Node-resolution guarantee" that was relaxed when
 * switching tsconfig.build.server.json from NodeNext to Bundler/Preserve. Unlike
 * running NodeNext --noEmit against dist (which would false-positive on dead .jsx
 * emits), this tool checks only "does the target file exist" — making it safe for
 * dead client emit (.jsx files referenced from server .js).
 *
 * Does NOT boot the server; lazy/dynamic imports are also checked (no boot
 * dependency = no coverage gap for conditional/lazy imports).
 *
 * Authored in TypeScript and executed directly by Node's native type stripping
 * (Node >= 22.18, on by default). It imports only node: builtins, so it needs
 * no path-alias resolver hook and stays a zero-dependency build tool.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type VerifyDistResolutionResult = {
  checked: number;
  unresolved: string[];
};

/**
 * Regex to capture relative import specifiers (./ or ../) and residual
 * path-alias specifiers (~/ or ^/) from both static and dynamic imports.
 * Captures:
 *   group 1: the specifier string (without quotes)
 */
const RELATIVE_IMPORT_RE =
  /\b(?:from|import)\s*\(\s*['"](\.[^'"]+|[~^]\/[^'"]*)['"]\s*(?:with\s*\{[^}]*\})?\s*\)|\bfrom\s*['"](\.[^'"]+|[~^]\/[^'"]*)['"]\s*(?:with\s*\{[^}]*\})?/g;

/**
 * Regex to detect whether a line is purely a comment line (should be skipped).
 * Matches lines like:
 *   // comment
 *    * JSDoc line
 *    * @example import('./foo')
 */
const COMMENT_LINE_RE = /^\s*(\/\/|\*)/;

/**
 * Walk `dir` recursively, collecting all .js files.
 */
function walkJs(dir: string, acc: string[] = []): string[] {
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
 * Main entry point. Checks all .js files under `distRoot` for unresolvable
 * relative import specifiers.
 *
 * @param distRoot  absolute path to the dist directory
 */
export function verifyDistResolution(
  distRoot: string,
): VerifyDistResolutionResult {
  let checked = 0;
  const unresolved: string[] = [];

  for (const file of walkJs(distRoot)) {
    const importerDir = dirname(file);
    const content = readFileSync(file, 'utf8');

    // Process line by line to skip comment lines (// and * JSDoc lines).
    // This avoids false positives from JSDoc @example code like import('./Foo').
    for (const line of content.split('\n')) {
      // Skip pure comment lines
      if (COMMENT_LINE_RE.test(line)) continue;

      // Reset regex state for each line
      RELATIVE_IMPORT_RE.lastIndex = 0;

      let match = RELATIVE_IMPORT_RE.exec(line);
      while (match !== null) {
        // group 1 = dynamic import('...') specifier, group 2 = from '...' specifier
        const spec = match[1] ?? match[2];
        match = RELATIVE_IMPORT_RE.exec(line);
        if (!spec) continue;

        checked += 1;

        // A residual path alias means postbuild alias rewriting was skipped
        // or failed — Node cannot resolve it at runtime.
        if (spec.startsWith('~/') || spec.startsWith('^/')) {
          const location = `${file}: '${spec}' (residual path alias)`;
          unresolved.push(location);
          // biome-ignore lint/suspicious/noConsole: build script diagnostic
          console.warn(`[verify-dist-resolution] unresolved: ${location}`);
          continue;
        }

        // Resolve the specifier to an absolute path
        const target = resolve(importerDir, spec);

        if (!existsSync(target)) {
          const location = `${file}: '${spec}'`;
          unresolved.push(location);
          // biome-ignore lint/suspicious/noConsole: build script diagnostic
          console.warn(`[verify-dist-resolution] unresolved: ${location}`);
        }
      }
    }
  }

  return { checked, unresolved };
}

// Allow direct CLI invocation: node verify-dist-resolution.ts <distRoot>
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const distRoot = process.argv[2];
  if (!distRoot) {
    // biome-ignore lint/suspicious/noConsole: build script diagnostic
    console.error('Usage: node verify-dist-resolution.ts <distRoot>');
    process.exit(1);
  }
  const result = verifyDistResolution(distRoot);
  // biome-ignore lint/suspicious/noConsole: build script summary
  console.log(
    `[verify-dist-resolution] checked ${result.checked} specifier(s), unresolved: ${result.unresolved.length}`,
  );
  if (result.unresolved.length > 0) {
    process.exit(1);
  }
}
