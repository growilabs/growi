/**
 * Parsing of a single `### Repro result` comment (the comment
 * `.github/workflows/flaky-repro.yml` posts) against one target commit SHA.
 *
 * A tracking issue accumulates one of these comments per repro run — the
 * confirmation measurement, a later rate measurement, a fix verification — so
 * "the newest one" is not the same thing as "the one for this commit". This
 * module answers only "does this one comment, taken on its own, carry a
 * `- Commit:` line naming this SHA, and what does it say" — deciding which of
 * several same-commit comments wins (`created_at` then `id`, newest last) is
 * the caller's job, because that requires comparing across comments, which a
 * function scoped to one comment body cannot do.
 */
import { COMMENT_HEADINGS, REPRO_RESULT_LINE_PREFIXES } from './constants.ts';
import { compareIso } from './time.ts';

export type ReproResult = {
  readonly runs: number;
  readonly failed: number;
  readonly perRun: readonly string[];
  readonly workflowRunUrl: string;
};

/** The subset of a GitHub issue-comment object every caller of `selectNewestMatch` has in hand. */
export type ReproComment = {
  readonly id: number;
  readonly created_at: string;
  readonly body: string;
  readonly html_url: string;
};

export type ReproMatch = {
  readonly comment: ReproComment;
  readonly result: ReproResult;
};

const [
  COMMIT_PREFIX,
  ,
  ,
  RUNS_PREFIX,
  FAILED_PREFIX,
  PER_RUN_PREFIX,
  WORKFLOW_RUN_PREFIX,
] = REPRO_RESULT_LINE_PREFIXES;

/**
 * First matching line's value, mirroring `grep -m1`: the procedure's own
 * comment ends with a failing-run excerpt that can itself contain a line
 * starting with one of these prefixes, so only the first match counts.
 */
const firstLineValue = (
  lines: readonly string[],
  prefix: string,
): string | undefined =>
  lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);

const toInteger = (text: string | undefined): number | null => {
  if (text == null) {
    return null;
  }
  const value = Number.parseInt(text, 10);
  return Number.isInteger(value) ? value : null;
};

/**
 * `null` when the comment is not a `### Repro result` comment, or does not
 * carry a `- Commit: <sha>` line, or is missing one of the fields this
 * function reports.
 */
export const parse = (body: string, sha: string): ReproResult | null => {
  if (!body.startsWith(COMMENT_HEADINGS.reproResult)) {
    return null;
  }
  const lines = body.split('\n');
  // Scanning every line (not just the first block) matches the procedure's
  // former `split("\n") | any(. == "- Commit: " + $sha)` check.
  if (!lines.includes(`${COMMIT_PREFIX}${sha}`)) {
    return null;
  }

  const runs = toInteger(firstLineValue(lines, RUNS_PREFIX));
  const failed = toInteger(firstLineValue(lines, FAILED_PREFIX));
  const workflowRunUrl = firstLineValue(lines, WORKFLOW_RUN_PREFIX);
  if (runs == null || failed == null || workflowRunUrl == null) {
    return null;
  }

  const perRunText = firstLineValue(lines, PER_RUN_PREFIX);
  const perRun =
    perRunText == null || perRunText === ''
      ? []
      : perRunText.split(',').map((entry) => entry.trim());

  return { runs, failed, perRun, workflowRunUrl };
};

/**
 * The newest comment (by `created_at`, then the larger `id` on an exact tie)
 * among `comments` whose body carries a `- Commit:` line naming `sha`, or
 * `null` when none do. A tracking issue can carry more than one `### Repro
 * result` comment for the same commit (a manually re-run repro job leaves a
 * second one behind), so picking "the" tally for a commit means comparing
 * across comments, not just parsing one — this is that comparison, shared by
 * `read-repro-result.ts` and `pr-gate-facts.ts` (task 3.9) so the two scripts
 * cannot drift on what "the tally for this commit" means.
 */
export const selectNewestMatch = (
  comments: readonly ReproComment[],
  sha: string,
): ReproMatch | null => {
  const matches: readonly ReproMatch[] = comments.flatMap((comment) => {
    const result = parse(comment.body, sha);
    return result == null ? [] : [{ comment, result }];
  });
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((latest, candidate) => {
    const byTime = compareIso(
      candidate.comment.created_at,
      latest.comment.created_at,
    );
    if (byTime > 0) {
      return candidate;
    }
    if (byTime < 0) {
      return latest;
    }
    return candidate.comment.id > latest.comment.id ? candidate : latest;
  });
};
