// Compare two module-load logs (from module-log.mjs) and report:
//  - per-package file counts on each side
//  - packages only loaded on side B (new eager loads)
//  - packages only loaded on side A (no longer loaded)
// Usage: node analyze-modules.mjs <modules-A.txt> <modules-B.txt> [labelA] [labelB]
import { readFileSync } from 'node:fs';

const [fileA, fileB, labelA = 'A', labelB = 'B'] = process.argv.slice(2);

function normalize(url) {
  if (url.startsWith('node:')) return { pkg: '(node builtin)', file: url };
  // pnpm store path: .../.pnpm/<dirname>/node_modules/<pkgpath>
  const pnpmMatch = url.match(/\.pnpm\/([^/]+)\/node_modules\/(.+)$/);
  if (pnpmMatch) {
    // dirname like: mongoose@6.13.9_hash or @aws-sdk+client-s3@3.600.0_peerhash
    const dir = pnpmMatch[1];
    // first '@' after position 0 separates name from version (handles @scope+name@ver_peerhash)
    const at = dir.indexOf('@', 1);
    const name = dir.slice(0, at).replace(/\+/g, '/');
    const version = dir.slice(at + 1).split('_')[0];
    return { pkg: name, version, file: pnpmMatch[2] };
  }
  const wsMatch = url.match(/\/packages\/([^/]+)\/(.+)$/);
  if (wsMatch) return { pkg: `@growi/${wsMatch[1]}`, file: wsMatch[2] };
  const distMatch = url.match(/\/apps\/app\/(dist\/.+)$/);
  if (distMatch) return { pkg: '(app dist)', file: distMatch[1] };
  const nextMatch = url.match(/\/apps\/app\/(\.next\/.+)$/);
  if (nextMatch) return { pkg: '(next build)', file: nextMatch[1] };
  const binMatch = url.match(/\/apps\/app\/(bin\/.+)$/);
  if (binMatch) return { pkg: '(app bin)', file: binMatch[1] };
  const nmMatch = url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/);
  if (nmMatch) return { pkg: nmMatch[1], file: nmMatch[2] };
  return { pkg: '(other)', file: url };
}

function load(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const pkgs = new Map(); // pkg -> { files:Set, versions:Set }
  for (const line of lines) {
    const { pkg, version, file } = normalize(line);
    if (!pkgs.has(pkg))
      pkgs.set(pkg, { files: new Set(), versions: new Set() });
    const e = pkgs.get(pkg);
    e.files.add(file);
    if (version) e.versions.add(version);
  }
  return { total: lines.length, pkgs };
}

const a = load(fileA);
const b = load(fileB);

console.log(`# Totals`);
console.log(`${labelA}: ${a.total} module loads, ${a.pkgs.size} packages`);
console.log(`${labelB}: ${b.total} module loads, ${b.pkgs.size} packages`);

const fmt = (e) =>
  `${e.files.size} files${e.versions.size ? ` (${[...e.versions].join(',')})` : ''}`;

console.log(`\n# Packages loaded ONLY in ${labelB} (sorted by file count)`);
const onlyB = [...b.pkgs]
  .filter(([p]) => !a.pkgs.has(p))
  .sort((x, y) => y[1].files.size - x[1].files.size);
for (const [p, e] of onlyB) console.log(`  ${p}: ${fmt(e)}`);

console.log(`\n# Packages loaded ONLY in ${labelA} (sorted by file count)`);
const onlyA = [...a.pkgs]
  .filter(([p]) => !b.pkgs.has(p))
  .sort((x, y) => y[1].files.size - x[1].files.size);
for (const [p, e] of onlyA) console.log(`  ${p}: ${fmt(e)}`);

console.log(`\n# Packages in both with large file-count delta (|delta| >= 10)`);
const both = [...b.pkgs]
  .filter(([p]) => a.pkgs.has(p))
  .map(([p, e]) => [p, a.pkgs.get(p).files.size, e.files.size])
  .filter(([, ca, cb]) => Math.abs(cb - ca) >= 10)
  .sort((x, y) => y[2] - y[1] - (x[2] - x[1]));
for (const [p, ca, cb] of both)
  console.log(
    `  ${p}: ${labelA}=${ca} ${labelB}=${cb} (${cb - ca >= 0 ? '+' : ''}${cb - ca})`,
  );

console.log(`\n# Top 25 packages by file count in ${labelB}`);
for (const [p, e] of [...b.pkgs]
  .sort((x, y) => y[1].files.size - x[1].files.size)
  .slice(0, 25)) {
  const inA = a.pkgs.get(p);
  console.log(
    `  ${p}: ${e.files.size} files${inA ? ` (${labelA}: ${inA.files.size})` : '  ** NEW **'}`,
  );
}
