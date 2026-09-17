import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { checkFixtureWiring, parseArgv } from './check-fixture-wiring.ts';

describe('check-fixture-wiring.parseArgv', () => {
  it('returns help for --help', () => {
    expect(parseArgv(['--help'])).toEqual({ kind: 'help' });
  });

  it('returns args for an empty argv (this script takes no arguments)', () => {
    expect(parseArgv([])).toEqual({ kind: 'args' });
  });

  it('rejects any positional/flag argument', () => {
    const result = parseArgv(['--issue', '1']);
    expect(result.kind).toBe('invalid');
  });
});

describe('check-fixture-wiring.checkFixtureWiring', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot != null) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  const makeTempTree = (): { fixturesDir: string; specSourceDir: string } => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'check-fixture-wiring-'));
    const fixturesDir = path.join(tmpRoot, 'fixtures');
    const specSourceDir = path.join(tmpRoot, 'src');
    mkdirSync(path.join(fixturesDir, 'api'), { recursive: true });
    mkdirSync(specSourceDir, { recursive: true });
    return { fixturesDir, specSourceDir };
  };

  it('reports a deliberately-unreferenced fixture as unwired, and leaves referenced fixtures out', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    // Referenced fixture: its fixtures-relative path is embedded in a spec file's source.
    writeFileSync(
      path.join(fixturesDir, 'api', 'referenced.json'),
      '{"ok":true}',
    );
    writeFileSync(
      path.join(specSourceDir, 'referenced.spec.ts'),
      "readFileSync(new URL('../fixtures/api/referenced.json', import.meta.url))",
    );

    // Deliberately unreferenced dummy fixture: no spec file mentions its path.
    writeFileSync(
      path.join(fixturesDir, 'api', 'unreferenced-dummy.json'),
      '{"ok":true}',
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.checked).toBe(2);
    expect(result.unwired).toEqual(['api/unreferenced-dummy.json']);
  });

  it('excludes .meta.md files from both the checked count and the unwired report', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    // .meta.md describing an unreferenced fixture: the fixture itself is
    // unwired, but the .meta.md file is never counted or reported.
    writeFileSync(
      path.join(fixturesDir, 'api', 'undocumented.json'),
      '{"ok":true}',
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'undocumented.json.meta.md'),
      '- **Real.** some source note',
    );
    writeFileSync(
      path.join(specSourceDir, 'empty.spec.ts'),
      '// no fixtures referenced here',
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.checked).toBe(1);
    expect(result.unwired).toEqual(['api/undocumented.json']);
  });

  it('scans nested directories on both sides (fixtures subfolders, and specs under nested src folders)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    mkdirSync(path.join(fixturesDir, 'lockfile', 'nested'), {
      recursive: true,
    });
    mkdirSync(path.join(specSourceDir, 'deep', 'nested'), {
      recursive: true,
    });
    writeFileSync(
      path.join(fixturesDir, 'lockfile', 'nested', 'diff.patch'),
      'patch contents',
    );
    writeFileSync(
      path.join(specSourceDir, 'deep', 'nested', 'consumer.spec.ts'),
      "readFileSync(new URL('../../fixtures/lockfile/nested/diff.patch', import.meta.url))",
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.checked).toBe(1);
    expect(result.unwired).toEqual([]);
  });
});

describe('check-fixture-wiring.checkFixtureWiring — the real bin/flaky-ci fixtures tree', () => {
  it('does not report a fixture that is genuinely referenced by an existing *.spec.ts', () => {
    const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
    const flakyCiDir = path.join(scriptsDir, '..');
    const fixturesDir = path.join(flakyCiDir, 'fixtures');

    const result = checkFixtureWiring(fixturesDir, flakyCiDir);

    // identity/flaky-issue-titles.json is read by lib/identity.spec.ts via a
    // literal relative-path string (see that file), so it must never appear
    // in unwired — the actual regression this task guards against.
    expect(result.checked).toBeGreaterThan(0);
    expect(result.unwired).not.toContain('identity/flaky-issue-titles.json');
    expect(result.unwired).not.toContain(
      'expected/parse-identity-key-titles.json',
    );
  });

  it("does not report the job-logs/*.txt fixtures referenced only through lib/job-log.spec.ts's readFixture(name) helper", () => {
    const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
    const flakyCiDir = path.join(scriptsDir, '..');
    const fixturesDir = path.join(flakyCiDir, 'fixtures');

    const result = checkFixtureWiring(fixturesDir, flakyCiDir);

    // These are never present as one contiguous "job-logs/<file>" substring
    // anywhere in lib/job-log.spec.ts: the directory is baked into a
    // template literal and the filename is passed separately as a plain
    // string argument to readFixture(). The reviewer-verified bug reported
    // all of these as unwired.
    //
    // NB: the path segments below are joined at runtime, not written as one
    // contiguous literal, on purpose — this spec file is itself scanned by
    // checkFixtureWiring (it lives under bin/flaky-ci), so a literal
    // "job-logs/<file>" string here would satisfy the OLD (buggy) full-path
    // substring check all by itself and silently defeat this regression test.
    const jobLogsDir = 'job-logs';
    const jobLogFixture = (name: string): string =>
      [jobLogsDir, name].join('/');

    expect(result.unwired).not.toContain(
      jobLogFixture('11752-setup-hook-timeout-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('11849-repro-result-log-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('11903-playwright-flaky-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('11914-playwright-flaky-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('ci-app-test-100952911197-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('constructed-97-failures-one-infra-noise-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('constructed-playwright-1-failed-0-flaky-excerpt.txt'),
    );
    expect(result.unwired).not.toContain(
      jobLogFixture('constructed-setup-hook-infra-noise-excerpt.txt'),
    );
  });

  it('still reports a genuinely unreferenced fixture as unwired', () => {
    const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
    const flakyCiDir = path.join(scriptsDir, '..');
    const fixturesDir = path.join(flakyCiDir, 'fixtures');

    const result = checkFixtureWiring(fixturesDir, flakyCiDir);

    // The two-part (directory + basename) check does not itself defeat
    // detection of genuinely unwired files: none of the md files under the
    // "expected" fixtures subdirectory are read by any *.spec.ts, and the
    // fix must not silently swallow that.
    //
    // NB: both the directory word and the filename are kept out of any
    // "fixtures/<dir>/" or quoted-basename shape anywhere in this file
    // (including comments) on purpose — this spec file is itself scanned
    // by checkFixtureWiring (it lives under bin/flaky-ci), so writing
    // either check's trigger shape here would make this spec file wrongly
    // wire the fixture away, breaking this negative-control assertion.
    const unreferencedDir = 'exp' + 'ected';
    const unreferencedFile = 'render-dash' + 'board.md';
    expect(result.unwired).toContain(
      [unreferencedDir, unreferencedFile].join('/'),
    );
  });
});

describe('check-fixture-wiring.checkFixtureWiring — readFixture(name)-style helper pattern', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot != null) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  const makeTempTree = (): { fixturesDir: string; specSourceDir: string } => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'check-fixture-wiring-helper-'));
    const fixturesDir = path.join(tmpRoot, 'fixtures');
    const specSourceDir = path.join(tmpRoot, 'src');
    mkdirSync(path.join(fixturesDir, 'job-logs'), { recursive: true });
    mkdirSync(specSourceDir, { recursive: true });
    return { fixturesDir, specSourceDir };
  };

  it('does not report a fixture referenced only through a readFixture(name)-style helper, where the directory is baked into a template literal and the filename is passed as a separate string argument', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    // NB: this fixture is deliberately NOT named the same as the reviewer's
    // own manual real-tree probe filename for the cross-context
    // contamination bug this task fixes (a "helper-referenced" dot-txt file
    // under fixtures/job-logs). This spec file (check-fixture-wiring.spec.ts)
    // is itself scanned by checkFixtureWiring when the real fixtures tree is
    // checked (it lives under bin/flaky-ci), so writing that exact filename
    // as a quoted-and-parenthesized readFixture argument right here — inside
    // a job-logs-directory-referencing helperSpecSource string — would make
    // THIS spec file's own source satisfy the helper pattern for any real
    // fixture of that same name, silently defeating the manual probe. Note
    // this paragraph itself avoids writing that filename as a quoted,
    // parenthesized literal for the same reason.
    const syntheticFixtureName = 'synthetic-readfixture-helper-test.txt';
    writeFileSync(
      path.join(fixturesDir, 'job-logs', syntheticFixtureName),
      'log contents',
    );
    const helperSpecSource = `const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
const HELPER_REFERENCED = readFixture(${JSON.stringify(syntheticFixtureName)});`;
    writeFileSync(
      path.join(specSourceDir, 'job-log.spec.ts'),
      helperSpecSource,
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toEqual([]);
  });

  it('still reports a fixture as unwired when neither the full-path check nor the two-part (directory + basename) check finds it', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'truly-unreferenced.txt'),
      'log contents',
    );
    // Mentions the job-logs directory (satisfying the directory half of the
    // check) but never mentions this fixture's filename anywhere, so the
    // basename half must still fail and the fixture must be reported.
    writeFileSync(
      path.join(specSourceDir, 'other.spec.ts'),
      "readFileSync(new URL('../fixtures/job-logs/some-other-file.txt', import.meta.url))",
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toEqual(['job-logs/truly-unreferenced.txt']);
  });

  it('does not let an unrelated quoted basename in a DIFFERENT file combine with a helper-pattern directory reference in ANOTHER file to falsely mark a fixture wired (cross-file/cross-context contamination)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    // Fixture A: genuinely wired via the helper pattern, entirely within
    // wired.spec.ts (both the `fixtures/job-logs/` directory reference and
    // the quoted basename appear together in this one file).
    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'wired.txt'),
      'log contents',
    );
    writeFileSync(
      path.join(specSourceDir, 'wired.spec.ts'),
      `const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
const WIRED = readFixture('wired.txt');`,
    );

    // Fixture B: NOT read by any test anywhere. Its basename happens to
    // appear as a quoted string in a completely different, unrelated spec
    // file — but only inside a comment/constant, never as the argument to a
    // fixture-reading call. Before the per-file fix, this quoted basename
    // (from unrelated.spec.ts) could combine with the `fixtures/job-logs/`
    // directory reference (from wired.spec.ts) via the concatenated-blob
    // check and falsely report fixture B as wired.
    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'contaminated.txt'),
      'log contents',
    );
    writeFileSync(
      path.join(specSourceDir, 'unrelated.spec.ts'),
      "// unrelated comment mentioning 'contaminated.txt', not a fixture read\nconst SOME_UNRELATED_CONSTANT = 'contaminated.txt';",
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toContain('job-logs/contaminated.txt');
    expect(result.unwired).not.toContain('job-logs/wired.txt');
  });

  it('does not let a plain (non-function) declaration mentioning the fixtures directory combine with an unrelated quoted basename elsewhere in the SAME file to falsely mark a fixture wired (round-3 regression: parenthesized-but-uncorrelated co-occurrence)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'round3-repro.txt'),
      'log contents',
    );
    // LOG_DIR_DOC mentions the fixtures/job-logs/ directory shape, but it is
    // a plain string constant, not a helper call — it never reads any
    // fixture. Elsewhere in the same file, an unrelated expect() call
    // happens to have a quoted string immediately inside parentheses. Before
    // the identifier-correlation fix, the directory half and the "quoted
    // basename in parens" half could both match this one file's source
    // without ever being the same call, producing a false "wired" verdict.
    const source = `const LOG_DIR_DOC = '../fixtures/job-logs/README';
expect(x).toBe('not-actually-read.txt');`;
    writeFileSync(path.join(specSourceDir, 'round3.spec.ts'), source);

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toContain('job-logs/round3-repro.txt');
  });

  it('recognizes a `function` declaration form (not only `const` arrow) as a helper whose call site wires a fixture', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'function-helper.txt'),
      'log contents',
    );
    const source = `function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
}
const CONTENT = readFixture('function-helper.txt');`;
    writeFileSync(path.join(specSourceDir, 'function-helper.spec.ts'), source);

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).not.toContain('job-logs/function-helper.txt');
  });

  it('does not let a call to a helper for one directory falsely wire a same-named fixture under a DIFFERENT directory (two helpers, two directories, one file)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();
    mkdirSync(path.join(fixturesDir, 'api'), { recursive: true });

    // Both fixtures share the same basename, in different directories.
    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'shared-name.txt'),
      'log contents',
    );
    writeFileSync(
      path.join(fixturesDir, 'api', 'shared-name.txt'),
      'api contents',
    );

    // Only the job-logs helper is ever called; the api helper is declared
    // but never invoked, so the api fixture must remain unwired.
    const source = `const readJobLog = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
const readApiFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/api/\${name}\`, import.meta.url)),
    'utf8',
  );
const CONTENT = readJobLog('shared-name.txt');`;
    writeFileSync(path.join(specSourceDir, 'two-helpers.spec.ts'), source);

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).not.toContain('job-logs/shared-name.txt');
    expect(result.unwired).toContain('api/shared-name.txt');
  });

  it('does not let a property/method-access call on an unrelated object satisfy the correlated-call pattern for a same-named local helper that is never itself invoked (round-4 regression: `\\b` matches right after `.`)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'never-actually-read.txt'),
      'log contents',
    );
    // `readFixture` is declared locally and its own body mentions the
    // job-logs directory, so it qualifies as a candidate helper identifier —
    // but it is NEVER called as a bare invocation anywhere in this file.
    // `someOtherModule.readFixture(...)` is a property/method access on a
    // completely different object that merely happens to share the name
    // `readFixture`; it must not count as a call to the local helper. Before
    // this fix, `\b` in the correlated-call pattern matched right after the
    // `.` (a non-word character), so this property access satisfied the
    // pattern exactly as if the local helper had been invoked directly.
    const source = `const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
const RESULT = someOtherModule.readFixture('never-actually-read.txt');`;
    writeFileSync(path.join(specSourceDir, 'property-access.spec.ts'), source);

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toContain('job-logs/never-actually-read.txt');
  });

  it('does not let a property/method-access call with whitespace or a newline between the `.` and the identifier satisfy the correlated-call pattern (round-5 regression: a fixed-width `(?<!\\.)` lookbehind only rejects zero-whitespace adjacency)', () => {
    const { fixturesDir, specSourceDir } = makeTempTree();

    writeFileSync(
      path.join(fixturesDir, 'job-logs', 'never-actually-read-either.txt'),
      'log contents',
    );
    // Same shape as the round-4 regression above, but with a newline and
    // indentation inserted between the `.` and the identifier — a property
    // access on `someOtherModule`, not a call to the local `readFixture`
    // helper declared below. A fixed-width `(?<!\.)` lookbehind (round 5)
    // only rejects a `.` immediately adjacent to the identifier, so this
    // still falsely satisfied the pattern; the variable-length `(?<!\.\s*)`
    // lookbehind (round 6) must reject it too.
    const source = `const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(\`../fixtures/job-logs/\${name}\`, import.meta.url)),
    'utf8',
  );
const RESULT = someOtherModule.
  readFixture('never-actually-read-either.txt');`;
    writeFileSync(
      path.join(specSourceDir, 'property-access-newline.spec.ts'),
      source,
    );

    const result = checkFixtureWiring(fixturesDir, specSourceDir);

    expect(result.unwired).toContain('job-logs/never-actually-read-either.txt');
  });
});
