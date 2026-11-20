#!/usr/bin/env node
/**
 * Reads one flaky-tracking issue's occurrence frequency — how many times it
 * was observed, and the earliest/latest of those observations — the same
 * computation `dashboard.ts` uses for its "First seen / Last seen /
 * Occurrences" columns.
 *
 * `investigate-flaky-test` runs this manually, once, right before posting a
 * pause comment for `flaky/needs-decision`, so it takes exactly one --issue
 * (unlike `awaiting-decision-rows.ts`'s repeatable --issue) — this script has
 * no multi-row batch to protect, so a fetch failure fails the whole call
 * rather than degrading to a per-row "unavailable" value.
 *
 * Usage: node occurrence-summary.ts --issue <number>
 *
 * Output fields (exit 0): firstSeen (ISO-8601 UTC or null), lastSeen
 * (ISO-8601 UTC or null), occurrences (number)
 * Exit 2: no --issue was given.
 */
import { pathToFileURL } from 'node:url';

import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { computeOccurrenceSummary } from '../lib/occurrence-summary.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node occurrence-summary.ts --issue <number>

Reads one issue's body and comments and reports its occurrence frequency:
how many times it was observed, and the earliest/latest of those
observations.

Output fields (exit 0): firstSeen (ISO-8601 UTC or null), lastSeen
(ISO-8601 UTC or null), occurrences (number)
Exit code 2: no --issue was given
`;

export type CliArgs = { readonly issue: string };

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
  const issue = flagValue(argv, 'issue');
  if (issue == null) {
    return { kind: 'invalid', reason: '--issue is required' };
  }
  return { kind: 'args', value: { issue } };
};

type RawLabel = { readonly name: string };

type RawIssue = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly labels: readonly RawLabel[];
};

type RawComment = { readonly body: string };

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
  let raw: RawIssue;
  let comments: readonly RawComment[];
  try {
    raw = await ghApi.get<RawIssue>(
      `repos/growilabs/growi/issues/${args.issue}`,
    );
    comments = await ghApi.getAll<RawComment>(
      `repos/growilabs/growi/issues/${args.issue}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      // Not a precondition failure this script knows how to name — let it
      // surface as an unexpected exception (exit 1) rather than mislabel it.
      throw error;
    }
    // Unlike the repeatable-`--issue` scripts, there is no other row here to
    // preserve — a fetch failure fails the whole call.
    return { ok: false, failure: { reason: error.message } };
  }

  const summary = computeOccurrenceSummary({
    number: raw.number,
    title: raw.title,
    labels: raw.labels.map((label) => label.name),
    body: raw.body,
    comments,
  });

  return { ok: true, facts: { ...summary } };
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
    run(createGhApi(), parsed.value).then(emit);
  }
}
