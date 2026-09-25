#!/usr/bin/env node
/**
 * Reads the newest observation date recorded against one flaky-tracking
 * issue, and which record it came from.
 *
 * Replaces the `awk` / `jq --paginate` pair that used to appear in
 * `flaky-ci-routine.md` §4-B: the maximum `Date:` value over exactly two
 * sources — the issue body's `### First observation` section, and every
 * comment whose first line begins with `### Additional observation` or
 * `### Backfilled observation`. Everything else (`### Repro result`,
 * `### Collateral candidate`, human comments, …) is excluded, because none of
 * those is an observation.
 *
 * Usage: node newest-observation.ts --issue <number>
 *
 * Output fields (exit 0): newest (ISO-8601 UTC), source (`body` or a comment id)
 * Exit 2: no `Date:` line could be read from the body or any observation comment.
 */
import { pathToFileURL } from 'node:url';

import { COMMENT_HEADINGS } from '../lib/constants.ts';
import { createGhApi, type GhApi, GhError } from '../lib/gh.ts';
import { emit, type ScriptResult } from '../lib/output.ts';
import { compareIso } from '../lib/time.ts';

const HELP = `Usage: node newest-observation.ts --issue <number>

Reads the issue body's ### First observation Date: line and every
### Additional observation / ### Backfilled observation comment's Date:
line, and reports the newest one and where it came from.

Output fields (exit 0): newest (ISO-8601 UTC), source (body or a comment id)
Exit code 2: no Date: line could be read anywhere on the issue
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

type Issue = { readonly body: string | null };
type Comment = { readonly id: number; readonly body: string };
type Candidate = { readonly newest: string; readonly source: 'body' | number };

/** First `- Date:` (the leading `-` is optional) inside one line block. */
const DATE_LINE = /^-?\s*Date:\s*(.+)$/;

const firstDateLine = (lines: readonly string[]): string | undefined => {
  for (const line of lines) {
    const match = DATE_LINE.exec(line);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
};

/**
 * The `Date:` line inside the body's `### First observation` section only —
 * mirrors the procedure's `awk '/^### First observation/{f=1;next} /^### /{f=0} f && …'`,
 * which stops scanning as soon as the next `### ` heading starts.
 */
const extractBodyDate = (body: string): string | undefined => {
  const lines = body.split('\n');
  const sectionStart = lines.findIndex((line) =>
    line.startsWith('### First observation'),
  );
  if (sectionStart === -1) {
    return undefined;
  }
  const sectionEnd = lines.findIndex(
    (line, index) => index > sectionStart && line.startsWith('### '),
  );
  const section = lines.slice(
    sectionStart + 1,
    sectionEnd === -1 ? undefined : sectionEnd,
  );
  return firstDateLine(section);
};

/**
 * The `Date:` line of a comment, but only when the comment is itself an
 * observation — its first line must begin with one of the two qualifying
 * headings. A `### Repro result` or investigation comment's excerpt can
 * contain a line that looks like a date field; the heading check is what
 * keeps those out, the same hazard `repro-result.ts` guards against for
 * `- Runs:` / `- Failed:`.
 */
const extractCommentDate = (commentBody: string): string | undefined => {
  const lines = commentBody.split('\n');
  const heading = lines[0] ?? '';
  const isObservation =
    heading.startsWith(COMMENT_HEADINGS.additionalObservation) ||
    heading.startsWith(COMMENT_HEADINGS.backfilledObservation);
  return isObservation ? firstDateLine(lines) : undefined;
};

export const run = async (
  ghApi: GhApi,
  args: CliArgs,
): Promise<ScriptResult> => {
  let issue: Issue;
  let comments: readonly Comment[];
  try {
    issue = await ghApi.get<Issue>(
      `repos/growilabs/growi/issues/${args.issue}`,
    );
    comments = await ghApi.getAll<Comment>(
      `repos/growilabs/growi/issues/${args.issue}/comments`,
    );
  } catch (error) {
    if (!(error instanceof GhError)) {
      // Not a precondition failure this script knows how to name — let it
      // surface as an unexpected exception (exit 1) rather than mislabel it.
      throw error;
    }
    return { ok: false, failure: { reason: error.message } };
  }

  // Validate each candidate's format as it is collected, not only inside the
  // reduce comparator below: `Array.prototype.reduce` with no seed never calls
  // the comparator when the array has exactly one element, so a single
  // malformed candidate would otherwise sail through uncompared and come back
  // as a fabricated success.
  const candidates: Candidate[] = [];
  const bodyDate = extractBodyDate(issue.body ?? '');
  if (bodyDate != null) {
    try {
      compareIso(bodyDate, bodyDate);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        failure: {
          reason: `issue ${args.issue} has an unreadable Date: value in its body (${reason})`,
        },
      };
    }
    candidates.push({ newest: bodyDate, source: 'body' });
  }
  for (const comment of comments) {
    const commentDate = extractCommentDate(comment.body);
    if (commentDate != null) {
      try {
        compareIso(commentDate, commentDate);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          failure: {
            reason: `issue ${args.issue} has an unreadable Date: value in comment ${comment.id} (${reason})`,
          },
        };
      }
      candidates.push({ newest: commentDate, source: comment.id });
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      failure: {
        reason: `issue ${args.issue} has no readable observation date (no ### First observation Date: line in the body, and no ### Additional observation / ### Backfilled observation comment)`,
      },
    };
  }

  const winner = candidates.reduce((latest, candidate) =>
    compareIso(candidate.newest, latest.newest) > 0 ? candidate : latest,
  );

  return {
    ok: true,
    facts: { newest: winner.newest, source: winner.source },
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
    run(createGhApi(), parsed.value).then(emit);
  }
}
