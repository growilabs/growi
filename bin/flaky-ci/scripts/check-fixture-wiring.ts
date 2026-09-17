#!/usr/bin/env node
/**
 * Checks whether every fixture file under `bin/flaky-ci/fixtures/` is
 * actually read by some test, so a fixture that stops being referenced (the
 * way `fixtures/expected/*.md` silently did before PR #11921's review caught
 * it — fixed in commit 51483394a2) is reported instead of quietly rotting.
 *
 * The reference check is a plain substring search, not an AST-aware analysis
 * (design.md `check-fixture-wiring.ts` Implementation Notes). Most existing
 * `*.spec.ts` files read a fixture via
 * `readFileSync(fileURLToPath(new URL('../fixtures/...', import.meta.url)))`,
 * i.e. the fixtures-relative path appears as one contiguous literal string
 * in the source, so checking whether that string occurs anywhere in a given
 * `*.spec.ts` file's source catches those.
 *
 * `bin/flaky-ci/lib/job-log.spec.ts` uses a different, also pre-existing
 * pattern: a `readFixture(name)` helper that bakes the directory into a
 * template literal and takes the filename as a separate string argument, so
 * the full "dir/filename" path never appears as one contiguous substring.
 * A fixture is therefore also treated as wired when a spec file's own
 * source both DECLARES a local helper whose own definition mentions the
 * fixture's parent directory (a `fixtures/<dir>/` substring, any `../`
 * depth), AND CALLS that same helper (by the identifier it was declared
 * under) with the fixture's basename as a quoted string argument. See
 * `isWiredViaHelperPattern` for the mechanism and why it correlates the two
 * halves by identifier rather than just checking they both occur somewhere
 * in the file. Both checks stay textual/mechanical, per the same non-AST
 * constraint.
 *
 * This helper-pattern check went through three rounds before landing on
 * identifier correlation, each fixing a false "wired" verdict the previous
 * round produced:
 *   1. Bare corpus-wide co-occurrence (directory mention anywhere in the
 *      concatenation of ALL spec files, basename mention anywhere in the
 *      concatenation) — an unrelated file mentioning the directory and a
 *      completely different file mentioning the basename combined into a
 *      false positive.
 *   2. Per-file co-occurrence (both halves required in the SAME file, but
 *      unscoped within it) — a directory mention in a comment/doc string
 *      and an unrelated quoted basename anywhere else in that same file
 *      still combined.
 *   3. Per-file, basename scoped to "quoted string immediately inside
 *      parentheses" (looks like a call argument) — but still not checked
 *      against a specific helper: a plain non-function constant mentioning
 *      the directory, plus an unrelated `expect(x).toBe('other.txt')` call
 *      elsewhere in the same file, still combined into a false positive
 *      because neither side was verified to be part of the SAME call.
 * Round 4 fixed this by extracting the identifiers of local declarations
 * whose own body mentions the directory, then requiring the basename to
 * appear as an argument to a call naming one of those SPECIFIC identifiers.
 *   5. Property/method-access false correlation (round 4's own regex used a
 *      plain `\b` word boundary before the identifier alternation, but `\b`
 *      also fires right after a `.`) — an unrelated
 *      `someOtherModule.readFixture('basename.txt')` property access on a
 *      completely different object, merely sharing a name with a local
 *      helper that was never itself called, satisfied the pattern as if the
 *      local helper had actually been invoked. Round 5 first tried a
 *      `(?<!\.)` negative lookbehind immediately before the identifier
 *      alternation, but that only rejects a `.` in the character
 *      IMMEDIATELY preceding the identifier — whitespace or a newline
 *      between the `.` and the identifier (`obj. readFixture(...)`, or a
 *      `.` at end of line with the call on the next line) still slipped
 *      through and reproduced the same false "wired" verdict.
 *   6. Round 5's own fix was too narrow for the same reason: it stopped only
 *      the zero-whitespace case, not `obj.\n  readFixture(...)` or
 *      `obj. readFixture(...)`.
 * The current mechanism (round 6) widens the lookbehind to `(?<!\.\s*)`, a
 * variable-length negative lookbehind (supported by V8) that rejects a `.`
 * followed by any amount of whitespace (including none, and including
 * newlines) immediately before the identifier — still requiring a bare call
 * rather than a property/method access, and still correctly rejecting
 * optional chaining (`?.`, `?.\n  `, ...) for the same reason.
 *
 * Both checks — the full-path substring and the two-part helper pattern —
 * are evaluated PER FILE, and a fixture counts as wired if ANY single spec
 * file satisfies one of them on its own. They are deliberately never
 * evaluated against the concatenation of all spec files' source: a
 * `fixtures/<dir>/`-shaped mention in one file and an unrelated quoted
 * basename in a completely different file (or an unrelated comment/constant
 * in the same file) must not combine into a false "wired" verdict. See the
 * "readFixture(name)-style helper pattern" tests for a reproduction.
 *
 * `.meta.md` files themselves are excluded from the check (Requirement 2.3):
 * they document a fixture, they are not fixture data a test reads. For the
 * same reason, `fixtures/README.md` (the directory's own operating manual,
 * not a fixture) is excluded too — flagging it as "unwired" every run would
 * be permanent, expected noise mixed in with genuine findings.
 *
 * Usage: node check-fixture-wiring.ts
 *
 * Output fields (exit 0): checked (number of fixture files considered),
 * unwired (fixtures-relative paths of files never mentioned in any
 * *.spec.ts source)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node check-fixture-wiring.ts

Scans bin/flaky-ci/fixtures/ (excluding *.meta.md files) and reports which
fixture files' fixtures-relative path never appears as a substring in the
source of any bin/flaky-ci/**/*.spec.ts file.

Output fields (exit 0): checked (number), unwired (string[])
`;

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args' }
  | { readonly kind: 'invalid'; readonly reason: string };

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  if (argv.length > 0) {
    return {
      kind: 'invalid',
      reason: `check-fixture-wiring takes no arguments (got ${argv.join(' ')})`,
    };
  }
  return { kind: 'args' };
};

export type WiringResult = {
  readonly checked: number;
  readonly unwired: readonly string[];
};

/** Recursively lists every regular file under `dir`, as POSIX-style paths relative to `dir`. */
const listFilesRelative = (dir: string): string[] => {
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        result.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return result;
};

/** Escapes regex metacharacters so a filename/dirname can be used literally in a RegExp. */
const escapeForRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a local declaration start: `const`/`let`/`var`/`function`, optionally `export`ed. */
const DECLARATION_PATTERN =
  /\b(?:export\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;

/**
 * Finds the identifiers of local declarations (`const`/`let`/`var`/
 * `function`, optionally `export`ed) in `fileSource` whose OWN declaration
 * body — the text from that declaration's start up to the next
 * declaration's start (or EOF) — mentions the fixture directory as a
 * `fixtures/<dirName>/` substring (any `../` depth). This scopes the
 * directory check to a single candidate helper's own definition, instead of
 * anywhere in the file, so it can later be correlated against a call to
 * that SAME identifier (see `isWiredViaHelperPattern`).
 */
const extractHelperIdentifiers = (
  fileSource: string,
  dirName: string,
): readonly string[] => {
  const dirPattern = new RegExp(
    `(?:\\.\\.\\/)*fixtures\\/${escapeForRegex(dirName)}\\/`,
  );

  const declarations: Array<{ name: string; offset: number }> = [];
  for (const match of fileSource.matchAll(DECLARATION_PATTERN)) {
    if (match.index == null) {
      continue;
    }
    declarations.push({ name: match[1], offset: match.index });
  }

  const identifiers: string[] = [];
  declarations.forEach(({ name, offset }, index) => {
    const windowEnd = declarations[index + 1]?.offset ?? fileSource.length;
    const window = fileSource.slice(offset, windowEnd);
    if (dirPattern.test(window)) {
      identifiers.push(name);
    }
  });
  return identifiers;
};

/**
 * Checks the `readFixture(name)`-style helper pattern (see module doc
 * comment) against a SINGLE spec file's own source. Unlike a bare
 * co-occurrence check, this correlates the two halves by identifier:
 *
 *   1. Find every locally-declared identifier whose OWN declaration body
 *      mentions the fixture's parent directory as a `fixtures/<dir>/`
 *      substring (`extractHelperIdentifiers`) — these are the candidate
 *      helper names.
 *   2. Require the fixture's basename to appear, as a quoted string
 *      literal, as an argument to a CALL naming one of those SPECIFIC
 *      identifiers (`identifier(...'basename'...)`), searched across the
 *      whole file (the call site is normally a separate statement from the
 *      helper's own definition).
 *
 * A directory mention and a quoted basename that merely occur somewhere in
 * the same file — in unrelated declarations, comments, or calls to
 * unrelated functions — no longer combine into a false "wired" verdict; see
 * the module doc comment for the three rounds of false positives this
 * replaces.
 */
const isWiredViaHelperPattern = (
  relativePath: string,
  fileSource: string,
): boolean => {
  const segments = relativePath.split('/');
  if (segments.length < 2) {
    // No parent directory to match against `fixtures/<dir>/` at all.
    return false;
  }
  const dirName = segments[segments.length - 2];
  const baseName = segments[segments.length - 1];

  const helperIdentifiers = extractHelperIdentifiers(fileSource, dirName);
  if (helperIdentifiers.length === 0) {
    return false;
  }

  // Allows an optional trailing comma (and surrounding whitespace/newlines)
  // before the closing paren, e.g. a multi-line call:
  //   readFixture(
  //     'name.txt',
  //   )
  //
  // `(?<!\.\s*)` immediately before the identifier alternation requires a
  // BARE call, not a property/method access: `\b` alone fires right after
  // `.` too (it is a non-word character), so `someOtherModule.readFixture(...)`
  // — a call on some OTHER object that merely happens to share the name of a
  // locally-declared helper — would otherwise satisfy the pattern exactly as
  // if the local helper had actually been invoked. The lookbehind is
  // variable-length (`\s*`, not a fixed single character) on purpose: a `.`
  // immediately before the identifier is not the only property-access shape
  // — `obj. readFixture(...)` and `obj.\n  readFixture(...)` are the same
  // property access with whitespace/a newline inserted after the `.`, and a
  // fixed-width `(?<!\.)` lookbehind (round 5) only rejected the
  // zero-whitespace case, leaving those still falsely correlated. This also
  // correctly rejects optional chaining (`?.readFixture(...)`, `?.\n  readFixture(...)`),
  // since that too ends in `.` before the (possibly whitespace-separated)
  // identifier.
  const correlatedCallPattern = new RegExp(
    `(?<!\\.\\s*)\\b(?:${helperIdentifiers.map(escapeForRegex).join('|')})\\s*\\(\\s*(['"\`])${escapeForRegex(baseName)}\\1\\s*,?\\s*\\)`,
  );

  return correlatedCallPattern.test(fileSource);
};

/**
 * Checks whether a single spec file's own source is evidence that the
 * fixture at `relativePath` is wired: either its fixtures-relative path
 * appears as one contiguous substring, or the file satisfies the
 * `readFixture(name)`-style helper pattern (see `isWiredViaHelperPattern`).
 * Both checks run against this ONE file's source only — never against a
 * concatenation of multiple files (see module doc comment for why).
 */
const isWiredInFile = (relativePath: string, fileSource: string): boolean =>
  fileSource.includes(relativePath) ||
  isWiredViaHelperPattern(relativePath, fileSource);

/**
 * Core check, factored out from the CLI entrypoint so it can be exercised
 * against temporary directories in tests instead of the real fixtures tree.
 *
 * `fixturesDir` is scanned for fixture files (every file except `.meta.md`);
 * `specSourceDir` is scanned for `*.spec.ts` files. A fixture is wired if
 * ANY single spec file's own source satisfies `isWiredInFile` — the check
 * never runs against a merged blob of all spec files (see module doc
 * comment).
 */
export const checkFixtureWiring = (
  fixturesDir: string,
  specSourceDir: string,
): WiringResult => {
  const fixtureFiles = listFilesRelative(fixturesDir).filter(
    (relativePath) =>
      !relativePath.endsWith('.meta.md') && relativePath !== 'README.md',
  );

  const specFiles = listFilesRelative(specSourceDir).filter((relativePath) =>
    relativePath.endsWith('.spec.ts'),
  );
  const specSources = specFiles.map((relativePath) =>
    readFileSync(path.join(specSourceDir, relativePath), 'utf8'),
  );

  const unwired = fixtureFiles.filter(
    (relativePath) =>
      !specSources.some((fileSource) =>
        isWiredInFile(relativePath, fileSource),
      ),
  );

  return { checked: fixtureFiles.length, unwired };
};

export const run = (): ScriptResult => {
  const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
  const flakyCiDir = path.join(scriptsDir, '..');
  const fixturesDir = path.join(flakyCiDir, 'fixtures');
  return { ok: true, facts: checkFixtureWiring(fixturesDir, flakyCiDir) };
};

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (entry == null) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
};

if (isMainModule()) {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  } else if (parsed.kind === 'invalid') {
    emit({ ok: false, failure: { reason: parsed.reason } });
  } else {
    emit(run());
  }
}
