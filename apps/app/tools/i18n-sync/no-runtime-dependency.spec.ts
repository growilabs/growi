import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Contract --------------------------------------------------------------
//
// The running GROWI application must never talk to POEditor itself — only
// the sync tooling in this directory (`apps/app/tools/i18n-sync/`), which
// runs from GitHub Actions, is allowed to call the POEditor API. If anyone
// ever imports `poeditor-client.ts` (or another file from this directory)
// into `apps/app/src/`, or hardcodes the POEditor domain into application
// code, the running app would gain a runtime dependency on POEditor's
// availability.
//
// This is a drift test with no natural RED state: today `apps/app/src/`
// has zero references to POEditor, so this spec passes trivially on the
// current repository. Its entire value is as a regression guard — it must
// keep failing if such a reference is ever introduced. Do not "simplify"
// this away because it looks like it never fails.
//
// Two independent signals are scanned for, since a runtime dependency can be
// introduced either as a code import or as a hardcoded literal:
//
// 1. Any reference to the `i18n-sync` tooling directory (an import/require
//    specifier, or even a stray comment naming it) — catches
//    `import { uploadTerms } from '../../tools/i18n-sync/poeditor-client'`
//    and similar.
// 2. The POEditor domain string (`poeditor.com`) appearing literally —
//    catches a hardcoded API endpoint even without importing this directory,
//    e.g. `fetch('https://api.poeditor.com/v2/...')` written directly into
//    application code.
//
// A plain content scan (rather than the static-import-graph walker used by
// the `no-eager-*-imports.spec.ts` family — see
// apps/app/.claude/rules/server-boot-imports.md) is the right tool here:
// that walker only flags *external npm package* specifiers reached via
// static import, so a relative import such as
// `../../tools/i18n-sync/poeditor-client` — which is exactly the shape a
// real violation would take, since `i18n-sync` is a sibling directory
// under `apps/app/tools/`, not an npm package — would resolve as an
// ordinary internal file and never reach the walker's banned-pattern check.
// It also would not catch a hardcoded domain string that isn't an import at
// all. A direct content scan over every source file under `apps/app/src/`
// answers both cases without inventing a new resolution strategy.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src',
);

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

type BannedSignal = {
  readonly label: string;
  readonly pattern: RegExp;
};

const BANNED_SIGNALS: readonly BannedSignal[] = [
  {
    label: 'reference to the i18n-sync sync tooling directory',
    pattern: /i18n-sync/i,
  },
  {
    label: 'POEditor domain string (hardcoded API endpoint)',
    pattern: /poeditor\.com/i,
  },
];

type Violation = {
  readonly file: string;
  readonly label: string;
};

const listSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  };
  walk(root);
  return files;
};

const findViolations = (root: string): Violation[] => {
  const violations: Violation[] = [];
  for (const file of listSourceFiles(root)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const signal of BANNED_SIGNALS) {
      if (signal.pattern.test(content)) {
        violations.push({
          file: path.relative(root, file),
          label: signal.label,
        });
      }
    }
  }
  return violations;
};

const formatViolation = (violation: Violation): string =>
  `${violation.file} => ${violation.label}`;

describe('no runtime dependency on POEditor from apps/app/src', () => {
  it('has no reference to the i18n-sync tooling or the POEditor domain under apps/app/src', () => {
    const violations = findViolations(SRC_ROOT);
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `The running GROWI application must never call POEditor at runtime — ` +
        `only apps/app/tools/i18n-sync/ (run from GitHub Actions) may talk to ` +
        `POEditor. Move this reference out of apps/app/src, or replace the ` +
        `hardcoded endpoint with a locale file already synced by the sync ` +
        `tooling.\n\n${formatted.join('\n')}`,
    ).toEqual([]);
  });

  // Guards the scanner itself: if SRC_ROOT were wrong (renamed/moved), the
  // scan above would silently walk zero files and pass vacuously.
  it('still scans a non-trivial number of source files under apps/app/src', () => {
    const fileCount = listSourceFiles(SRC_ROOT).length;

    expect(fileCount).toBeGreaterThan(100);
  });
});
