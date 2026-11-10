// Build step: `node scripts/add-js-extensions.ts <distRoot>`. tsc keeps the
// extensionless relative specifiers of src/ as they are, and Node's ESM loader
// does not search for extensions, so each one is pointed at the emitted file
// (./x -> ./x.js, ./dir -> ./dir/index.js). The same rules as apps/app's
// bin/add-js-extensions.ts, kept in this package (research.md 23.5).
// Runs under Node's type stripping: node: imports only, erasable syntax only.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AddJsExtensionsResult {
  readonly rewritten: number;
  readonly unresolved: readonly string[];
}

// from '…' / import('…') / import '…', for specifiers starting with ./ or ../
// (the emitted code has no comments: tsconfig.build.json removes them).
const RELATIVE_SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?(?:\/[^'"]*)?)\2/g;
const HAS_EXTENSION = /\.(?:[cm]?js|json)$/;

const resolveSpecifier = (
  directory: string,
  specifier: string,
): string | null => {
  const target = path.resolve(directory, specifier);
  if (existsSync(`${target}.js`)) {
    return `${specifier}.js`;
  }
  if (existsSync(path.join(target, 'index.js'))) {
    return `${specifier.replace(/\/$/, '')}/index.js`;
  }
  return null;
};

const javascriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return javascriptFiles(file);
    }
    return entry.isFile() && file.endsWith('.js') ? [file] : [];
  });

const rewriteFile = (
  file: string,
): { readonly rewritten: number; readonly unresolved: readonly string[] } => {
  const original = readFileSync(file, 'utf8');
  const unresolved: string[] = [];
  let rewritten = 0;
  const updated = original.replace(
    RELATIVE_SPECIFIER,
    (match, prefix: string, quote: string, specifier: string) => {
      if (HAS_EXTENSION.test(specifier)) {
        return match;
      }
      const resolved = resolveSpecifier(path.dirname(file), specifier);
      if (resolved == null) {
        unresolved.push(`${file}: '${specifier}'`);
        return match;
      }
      rewritten += 1;
      return `${prefix}${quote}${resolved}${quote}`;
    },
  );
  if (updated !== original) {
    writeFileSync(file, updated);
  }
  return { rewritten, unresolved };
};

export const addJsExtensions = (distRoot: string): AddJsExtensionsResult =>
  javascriptFiles(distRoot)
    .map(rewriteFile)
    .reduce<AddJsExtensionsResult>(
      (total, file) => ({
        rewritten: total.rewritten + file.rewritten,
        unresolved: [...total.unresolved, ...file.unresolved],
      }),
      { rewritten: 0, unresolved: [] },
    );

// Compared as paths, not URLs: on Windows argv[1] is never a URL pathname.
const isCommandLine =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCommandLine) {
  const [, , distRoot] = process.argv;
  if (distRoot == null) {
    process.stderr.write('usage: node add-js-extensions.ts <distRoot>\n');
    process.exit(1);
  }
  const result = addJsExtensions(path.resolve(distRoot));
  for (const location of result.unresolved) {
    process.stderr.write(`[add-js-extensions] unresolved: ${location}\n`);
  }
  process.stdout.write(
    `[add-js-extensions] rewrote ${result.rewritten} specifier(s)\n`,
  );
  if (result.unresolved.length > 0) {
    process.exit(1);
  }
}
