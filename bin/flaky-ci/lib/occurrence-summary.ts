/**
 * The frequency an issue's own observation records imply: how many times it
 * was observed, and the earliest/latest of those observations.
 *
 * This is the single computation `dashboard.ts` (the "First seen / Last seen
 * / Occurrences" table columns) and the pause-comment CLI (`occurrence-summary
 * .ts` under `scripts/`) both need, so it lives here as a pure function with
 * no network I/O, callable from either.
 */
import { COMMENT_HEADINGS } from './constants.ts';
import { compareIso } from './time.ts';

/** One issue, exactly as `fetch-flaky-issues.ts` reports it (extra fields are ignored). */
export type DashboardIssue = {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly body: string | null;
  readonly comments: readonly { readonly body: string }[];
};

export type OccurrenceSummary = {
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly occurrences: number;
};

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

/** A date this computation can order. An unorderable one is left out entirely. */
const isComparable = (value: string): boolean => {
  try {
    compareIso(value, value);
    return true;
  } catch {
    return false;
  }
};

const isObservationComment = (commentBody: string): boolean => {
  const heading = commentBody.split('\n', 1)[0] ?? '';
  return (
    heading.startsWith(COMMENT_HEADINGS.additionalObservation) ||
    heading.startsWith(COMMENT_HEADINGS.backfilledObservation)
  );
};

/**
 * The `Date:` line inside the body's `### First observation` section only —
 * scanning stops at the next `### ` heading, so a later section's date is not
 * mistaken for the first observation's.
 */
const bodyObservationDate = (body: string): string | undefined => {
  const lines = body.split('\n');
  const start = lines.findIndex((line) =>
    line.startsWith('### First observation'),
  );
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('### '),
  );
  return firstDateLine(lines.slice(start + 1, end === -1 ? undefined : end));
};

/**
 * Every date that counts: the body's first observation (if it has a readable
 * `Date:` line) plus each observation comment's own readable `Date:` line.
 * The issue's `created_at` / `updated_at` are deliberately not among them — a
 * backfilled observation can predate the issue, and bookkeeping moves
 * `updated_at`.
 */
const observationDates = (issue: DashboardIssue): readonly string[] => {
  const dates: string[] = [];
  const fromBody = bodyObservationDate(issue.body ?? '');
  if (fromBody != null && isComparable(fromBody)) {
    dates.push(fromBody);
  }
  for (const comment of issue.comments) {
    if (!isObservationComment(comment.body)) {
      continue;
    }
    const date = firstDateLine(comment.body.split('\n'));
    if (date != null && isComparable(date)) {
      dates.push(date);
    }
  }
  return dates;
};

/**
 * Occurrences is **1 for the issue body's own first observation** plus one per
 * observation comment — a heading match on the comment's first line and
 * nothing else, so every other comment kind (`### Repro result`, the Fix PR
 * marker, human notes) is excluded by construction. This counts observation
 * *events*, independent of whether each event's `Date:` line happens to
 * parse — an event with an unreadable date still happened, it is just not
 * orderable, which is why this is a separate pass from `observationDates`.
 */
const countOccurrences = (issue: DashboardIssue): number =>
  1 +
  issue.comments.filter((comment) => isObservationComment(comment.body)).length;

/**
 * `firstSeen`/`lastSeen` come from the dates that could actually be parsed;
 * `occurrences` comes from the separate event-count pass above. The two can
 * diverge — an issue whose body has an observation section with an unreadable
 * `Date:` line reports `occurrences: 1` alongside `firstSeen: null`, because
 * an event happened even though when it happened is unknown.
 */
export const computeOccurrenceSummary = (
  issue: DashboardIssue,
): OccurrenceSummary => {
  const dates = [...observationDates(issue)].sort(compareIso);
  return {
    firstSeen: dates[0] ?? null,
    lastSeen: dates.at(-1) ?? null,
    occurrences: countOccurrences(issue),
  };
};
