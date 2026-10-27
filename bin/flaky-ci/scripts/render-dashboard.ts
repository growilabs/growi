#!/usr/bin/env node
/**
 * The dashboard issue's body, rendered from the three lists
 * `flaky-ci-routine.md` Step 5 has in hand: the active issues, the rows of
 * `## Awaiting human decision`, and what Step 4 closed on this run.
 *
 * Replaces Step 5's table-assembly prose — the column sets, the row order, the
 * two sections' sort orders and cell rules, the three zero-state lines and the
 * 65536-character truncation rule. What stays in the procedure: **which**
 * issues and rows to pass in, and the dashboard issue's own
 * search / create / full-body-replace (Step 5 items 1, 2 and 4). This script
 * writes nothing to GitHub.
 *
 * The input arrives on **stdin** as one JSON object, shaped so the other
 * scripts' output can be pasted straight into it:
 *
 *   {
 *     "updatedAt": "2026-09-16T00:12:47Z",   // read from the clock by the caller
 *     "issues": [ … ],                       // fetch-flaky-issues.ts's issues[]
 *     "awaitingDecision": [ … ],             // awaiting-decision-rows.ts's rows[]
 *     "autoClosed": {
 *       "closed": [ { "issue": 11700, "newestObservation": "…" } ],
 *       "keptOpenByHumanReopen": [ 11701 ],
 *       "skippedUnreadableDate": [ 11712 ]
 *     },
 *     "notes": [ "…" ],                      // optional, e.g. the 2+ dashboards anomaly
 *     "paragraph": "…",                      // optional wording override
 *     "limit": 65536                          // optional, for testing
 *   }
 *
 * Usage: node render-dashboard.ts < input.json
 *
 * Output fields (exit 0): body — the Markdown body, ready to be written as the
 * dashboard issue's body verbatim.
 * Exit 2: stdin was empty, did not parse as JSON, or was missing one of the
 * three lists — rendering a list that was never supplied as empty would state
 * "nothing is waiting" where the truth is "nothing was read".
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { type DashboardInput, render } from '../lib/dashboard.ts';
import { emit, type ScriptResult } from '../lib/output.ts';

const HELP = `Usage: node render-dashboard.ts < input.json

Reads one JSON object on stdin — updatedAt, issues[] (fetch-flaky-issues.ts's
output), awaitingDecision[] (awaiting-decision-rows.ts's rows[]), autoClosed
{closed[], keptOpenByHumanReopen[], skippedUnreadableDate[]}, and the optional
notes[] / paragraph / limit — and returns the dashboard issue's Markdown body.

Output fields (exit 0): body
Exit code 2: stdin was empty, did not parse as JSON, or was missing one of the
three lists
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
      reason: `render-dashboard takes no arguments; the input is read from stdin (got ${argv.join(' ')})`,
    };
  }
  return { kind: 'args' };
};

const isArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/**
 * Every list the body needs must be present. A missing one is a precondition
 * failure, never an empty section: the zero-state lines are read as "nothing is
 * in this state", which is not what "this list was never loaded" means.
 */
const missingField = (value: Record<string, unknown>): string | null => {
  if (typeof value.updatedAt !== 'string' || value.updatedAt === '') {
    return 'updatedAt (the timestamp the caller read when it started writing)';
  }
  if (!isArray(value.issues)) {
    return 'issues[]';
  }
  if (!isArray(value.awaitingDecision)) {
    return 'awaitingDecision[]';
  }
  const autoClosed = value.autoClosed;
  if (typeof autoClosed !== 'object' || autoClosed == null) {
    return 'autoClosed';
  }
  const lists = autoClosed as Record<string, unknown>;
  for (const name of [
    'closed',
    'keptOpenByHumanReopen',
    'skippedUnreadableDate',
  ]) {
    if (!isArray(lists[name])) {
      return `autoClosed.${name}`;
    }
  }
  return null;
};

export const run = (inputText: string): ScriptResult => {
  if (inputText.trim() === '') {
    return {
      ok: false,
      failure: {
        reason:
          'stdin was empty: no dashboard input to render (an empty body is not an empty dashboard)',
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputText);
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: `stdin is not valid JSON: ${(error as Error).message}`,
      },
    };
  }

  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: {
        reason: 'stdin must be one JSON object, not an array or a scalar',
      },
    };
  }

  const missing = missingField(parsed as Record<string, unknown>);
  if (missing != null) {
    return {
      ok: false,
      failure: { reason: `the input is missing ${missing}` },
    };
  }

  return { ok: true, facts: { body: render(parsed as DashboardInput) } };
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
    // Read fd 0 in one go: a partially-read input would parse as broken JSON
    // at best, and as a shorter issue list at worst.
    let inputText: string;
    try {
      inputText = readFileSync(0, 'utf8');
    } catch (error) {
      emit({
        ok: false,
        failure: {
          reason: `could not read stdin: ${(error as Error).message}`,
        },
      });
    }
    emit(run(inputText));
  }
}
