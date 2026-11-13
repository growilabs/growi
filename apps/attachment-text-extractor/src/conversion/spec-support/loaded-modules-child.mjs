// Converts one file through the conversion layer's public entry in a fresh
// process and prints which modules it loaded.
// usage: node loaded-modules-child.mjs <file> <fileName>
// Plain node strips the TypeScript types; the resolve hook only adds the
// extension the src imports leave out.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const loaded = [];
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.')) {
        throw error;
      }
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return next(`${specifier}${suffix}`, context);
        } catch {
          // try the next suffix
        }
      }
      throw error;
    }
  },
  load(url, context, next) {
    loaded.push(url);
    return next(url, context);
  },
});

const [file, fileName] = process.argv.slice(2);
const { convert } = await import(new URL('../index.ts', import.meta.url).href);
const outcome = await convert(readFileSync(file), fileName, null, {
  maxXlsxCells: 70_000,
  maxPdfPages: 5_000,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 512 * 1024 * 1024,
  maxResultBytes: 16 * 1024 * 1024,
  maxCsvBytes: 8 * 1024 * 1024,
  maxHtmlBytes: 20 * 1024 * 1024,
});
const mappedFiles = readFileSync('/proc/self/maps', 'utf8')
  .split('\n')
  .map((line) => line.split(/\s+/)[5] ?? '')
  .filter((path) => path !== '');
process.stdout.write(
  JSON.stringify({
    kind: outcome.kind,
    loaded,
    mappedFiles: [...new Set(mappedFiles)],
  }),
);
