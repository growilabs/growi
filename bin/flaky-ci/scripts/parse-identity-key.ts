#!/usr/bin/env node
/**
 * The identity-key decomposition `investigate-flaky-test/SKILL.md` Step 1
 * currently spells out as a regex and a 4-step procedure, replaced by a
 * single call: given one issue title, returns kind / browser / spec path /
 * test title, and which of the three shapes the key is
 * (`precise` / `playwright-job-level` / `malformed`).
 *
 * All the parsing logic lives in `lib/identity.ts`; this file only wires the
 * CLI argument and the output contract. What to *do* with each of the three
 * shapes (read the linked run's Playwright report first, stop and report a
 * precondition failure, proceed straight to reproduction) stays a judgment
 * in the procedure — this script never fails for a malformed or job-level
 * key; that classification is itself the fact being reported.
 *
 * Usage: node parse-identity-key.ts --title "flaky: vitest:src/foo.spec.ts:some test"
 *
 * Output fields (exit 0): kind, browser, specPath, testTitle, shape.
 * Exit 2: --title was not given.
 */
import { pathToFileURL } from 'node:url';

import { parse } from '../lib/identity.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node parse-identity-key.ts --title <issue title>

Decomposes one flaky-tracking issue title into kind / browser / specPath /
testTitle, and which of the three identity-key shapes it is.

Output fields (exit 0):
  kind        "vitest" or "playwright", or null when no ":" at all is present
  browser     the Playwright browser segment, or null (vitest never has one,
              and a precise Playwright key may itself carry no browser
              segment)
  specPath    the spec (or setup) file path, or null for the job-level
              fallback and malformed shapes
  testTitle   verbatim, including any further ":" it contains, or null for
              the job-level fallback and malformed shapes
  shape       "precise" | "playwright-job-level" | "malformed"

Exit code 2: --title was not given.
`;

export type CliArgs = { readonly title: string };

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args'; readonly value: CliArgs }
  | { readonly kind: 'invalid'; readonly reason: string };

const flagValue = (
  argv: readonly string[],
  name: string,
): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  const title = flagValue(argv, 'title');
  if (title == null) {
    return { kind: 'invalid', reason: '--title is required' };
  }
  return { kind: 'args', value: { title } };
};

export const run = (args: CliArgs): ScriptResult => {
  const parsed = parse(args.title);
  return {
    ok: true,
    facts: {
      kind: parsed.kind,
      browser: parsed.browser,
      specPath: parsed.specPath,
      testTitle: parsed.testTitle,
      shape: parsed.shape,
    },
  };
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
    emit(run(parsed.value));
  }
}
