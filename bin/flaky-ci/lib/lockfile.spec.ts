import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { intersect, packagesInLog, packagesInPatch } from './lockfile.ts';

const readFixtureText = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(readFixtureText(relativePath));

const PATCH_11886 = readFixtureText(
  '../fixtures/lockfile/11886-pnpm-lock.patch',
);
const LOG_EXCERPT_11849 = readFixtureText(
  '../fixtures/job-logs/11849-repro-result-log-excerpt.txt',
);

describe('packagesInPatch', () => {
  it('matches the fixture-recorded 32-name extraction, except the one known rough edge this task fixes', () => {
    const expected = readFixtureJson(
      '../fixtures/lockfile/11886-extracted-package-names.json',
    ) as { readonly packages: readonly string[] };

    // `11886-extracted-package-names.json` records the *hand-applied*
    // extraction (before this task) of the two documented rules, including
    // its own documented `known_issues` bug: pnpm's single-line
    // leaf-package header shape `'@marijn/find-cluster-break@1.0.4': {}`
    // was mis-classified as a dependency-entry (because `{}` reads as
    // "something after the colon"), so the version stayed attached and both
    // `@marijn/find-cluster-break` and `@marijn/find-cluster-break@1.0.4`
    // ended up in the set. `packagesInPatch` classifies by whether the key
    // itself embeds a version instead, so it resolves that header line to
    // plain `@marijn/find-cluster-break` — the same name already produced by
    // the (unrelated, unaffected) dependency-entry line for the same
    // package — collapsing the fixture's 32 entries to 31 distinct names.
    const fixedExpected = new Set(expected.packages);
    fixedExpected.delete('@marijn/find-cluster-break@1.0.4');

    expect(packagesInPatch(PATCH_11886)).toEqual(fixedExpected);
  });

  it('includes @codemirror/state, the name this fixture set is for', () => {
    expect(packagesInPatch(PATCH_11886).has('@codemirror/state')).toBe(true);
  });

  it('strips a single trailing peer-resolution group before splitting on the last @', () => {
    const patch = "+  '@inquirer/checkbox@5.2.2(@types/node@24.13.4)':\n";
    expect(packagesInPatch(patch)).toEqual(new Set(['@inquirer/checkbox']));
  });

  it('strips chained trailing peer-resolution groups, not just one', () => {
    const patch =
      "-  '@tsed/platform-express@8.5.0(@tsed/core@8.5.0)(@tsed/di@8.5.0(@tsed/core@8.5.0))(multer@1.4.4)':\n";
    expect(packagesInPatch(patch)).toEqual(new Set(['@tsed/platform-express']));
  });

  it('strips a non-peer parenthesised annotation the same way (patch_hash)', () => {
    const patch =
      "+  '@marp-team/marp-core@3.9.1(patch_hash=9339c96cb1f7b7d331a5faf3719935af8d4f5415f1f8b88ee73aad42627c5dd4)':\n";
    expect(packagesInPatch(patch)).toEqual(new Set(['@marp-team/marp-core']));
  });

  it('takes a dependency-entry key directly, without splitting on @', () => {
    const patch = "-      '@codemirror/state': 6.7.1\n";
    expect(packagesInPatch(patch)).toEqual(new Set(['@codemirror/state']));
  });

  it('resolves the leaf-package header shape to the bare name, not name@version', () => {
    const patch = "+  '@marijn/find-cluster-break@1.0.4': {}\n";
    expect(packagesInPatch(patch)).toEqual(
      new Set(['@marijn/find-cluster-break']),
    );
  });

  it('reads the older unquoted /scope/name@version: header form', () => {
    const patch = '+  /@codemirror/state@6.7.4:\n';
    expect(packagesInPatch(patch)).toEqual(new Set(['@codemirror/state']));
  });

  it('ignores unchanged context lines and hunk headers', () => {
    const patch = [
      '@@ -3007,6 +3007,9 @@ packages:',
      "   '@codemirror/state@6.7.1':",
      "+  '@codemirror/state@6.7.4':",
      '',
    ].join('\n');
    expect(packagesInPatch(patch)).toEqual(new Set(['@codemirror/state']));
  });
});

describe('packagesInLog', () => {
  it('matches the fixture-recorded 5-name extraction from the real log excerpt', () => {
    expect(packagesInLog(LOG_EXCERPT_11849)).toEqual(
      new Set([
        '@codemirror/state',
        '@uiw/react-codemirror',
        'react-dom',
        'react',
        '@testing-library/react',
      ]),
    );
  });

  it('cuts a .pnpm/ segment at the first _ before splitting on the last @ (peer suffix)', () => {
    const excerpt =
      '❯ .../node_modules/.pnpm/@uiw+react-codemirror@4.23.8_@babel+runtime@7.29.7/node_modules/@uiw/react-codemirror/esm/useCodeMirror.js:80:124';
    expect(packagesInLog(excerpt)).toEqual(new Set(['@uiw/react-codemirror']));
  });

  it('resolves an unscoped peer-suffixed .pnpm/ segment the same way', () => {
    const excerpt =
      '❯ commitHookEffectListMount ../../node_modules/.pnpm/react-dom@18.2.0_react@18.2.0/node_modules/react-dom/cjs/react-dom.development.js:23150:26';
    expect(packagesInLog(excerpt)).toEqual(new Set(['react-dom']));
  });

  it('reads a plain node_modules/ frame with no .pnpm/ layer (scoped, two segments)', () => {
    const excerpt =
      '❯ .../node_modules/@uiw/react-codemirror/esm/useCodeMirror.js:80:124';
    expect(packagesInLog(excerpt)).toEqual(new Set(['@uiw/react-codemirror']));
  });

  it('reads a plain node_modules/ frame with no .pnpm/ layer (unscoped, one segment)', () => {
    const excerpt =
      '❯ .../node_modules/react-dom/cjs/react-dom.development.js:23150:26';
    expect(packagesInLog(excerpt)).toEqual(new Set(['react-dom']));
  });

  it('prefers the .pnpm/ segment over a nested node_modules/ path naming a different package', () => {
    // Synthetic: a .pnpm/ store directory for one package whose nested
    // node_modules/ re-export path names a *different* package name, to
    // pin that the .pnpm/ rule wins rather than the two rules disagreeing
    // silently on a frame where they'd otherwise agree.
    const excerpt =
      '❯ ../../node_modules/.pnpm/host-pkg@1.0.0/node_modules/reexported-pkg/index.js:1:1';
    expect(packagesInLog(excerpt)).toEqual(new Set(['host-pkg']));
  });

  it('ignores non-frame lines even when they mention node_modules paths', () => {
    const excerpt =
      'Error: Unrecognized extension value ([object Object]) from node_modules/@codemirror/state';
    expect(packagesInLog(excerpt)).toEqual(new Set());
  });
});

describe('intersect', () => {
  it('returns the single overlapping name for the real PR/log pairing', () => {
    const patchPackages = packagesInPatch(PATCH_11886);
    const logPackages = packagesInLog(LOG_EXCERPT_11849);
    expect(intersect(patchPackages, logPackages)).toEqual(
      new Set(['@codemirror/state']),
    );
  });

  it('returns every overlapping name, not just the first, when there is more than one', () => {
    const a = new Set(['pkg-a', 'pkg-b', 'pkg-c']);
    const b = new Set(['pkg-b', 'pkg-c', 'pkg-d']);
    expect(intersect(a, b)).toEqual(new Set(['pkg-b', 'pkg-c']));
  });

  it('returns an empty set when nothing overlaps', () => {
    expect(intersect(new Set(['a']), new Set(['b']))).toEqual(new Set());
  });
});
