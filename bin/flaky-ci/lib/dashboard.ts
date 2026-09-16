/**
 * The dashboard issue's body, rendered from the lists the routine loaded.
 *
 * `flaky-ci-routine.md` Step 5 used to spell out the whole assembly: the row
 * columns and their order, both sections' columns / sort orders / cell rules,
 * the three zero-state lines, and what to drop when the body exceeds GitHub's
 * character limit. All of that is mechanical, so it lives here.
 *
 * What stays a judgment in the procedure: **what to put in** — which issues are
 * active (open, whatever their `phase/*` label), which issues are awaiting a
 * decision, what Step 4 closed this run — plus finding, creating and replacing
 * the dashboard issue itself.
 *
 * `render` is pure: it reads no clock (the caller passes `updatedAt`, which it
 * must stamp at the moment it writes) and makes no request.
 */
import {
  BODY_CHAR_LIMIT,
  COMMENT_HEADINGS,
  LABELS,
  MARKERS,
  SIGNATURES,
  ZERO_STATE,
} from './constants.ts';
import { compareIso } from './time.ts';

export type Tier = 'confirmed' | 'suspected' | 'observing';

/** Strongest first — both the tier-label tie-break and the row order. */
const TIER_ORDER: readonly Tier[] = ['confirmed', 'suspected', 'observing'];

const TIER_LABELS: Readonly<Record<Tier, string>> = {
  confirmed: LABELS.confirmed,
  suspected: LABELS.suspected,
  observing: LABELS.observing,
};

/** What a cell with nothing to show contains. */
const EM_DASH = '—';

const TITLE = '# flaky-ci-routine dashboard';

/** Item 5's explanatory paragraph. Prose — a caller may pass its own. */
export const DEFAULT_PARAGRAPH =
  'This issue is created-or-updated every run of `/flaky-ci-routine` and its body is fully replaced each time — it is not a changelog, only a live snapshot of currently active flaky-test tracking issues.';

const TABLE_HEADER = [
  '| Identity | Tier | First seen | Last seen | Occurrences | Tracking issue | Fix PR |',
  '|---|---|---|---|---|---|---|',
].join('\n');

const AWAITING_HEADING = '## Awaiting human decision';
const AWAITING_TABLE_HEADER = [
  '| Tracking issue | Paused at | Recommendation | New observations since pause |',
  '|---|---|---|---|',
].join('\n');

const AUTO_CLOSED_HEADING = '## Auto-closed this run';
const AUTO_CLOSED_TABLE_HEADER = [
  '| Tracking issue | Newest observation |',
  '|---|---|',
].join('\n');

const KEPT_OPEN_PREFIX = '- Kept open by a human reopen: ';
const SKIPPED_PREFIX = '- Skipped (observation date unreadable): ';
/** What a bullet line says when its list is empty — the line itself always stays. */
const EMPTY_LIST = 'none.';

/** One issue, exactly as `fetch-flaky-issues.ts` reports it (extra fields are ignored). */
export type DashboardIssue = {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly body: string | null;
  readonly comments: readonly { readonly body: string }[];
};

/** One row, exactly as `awaiting-decision-rows.ts` reports it. */
export type AwaitingDecisionRow = {
  readonly issue: number | string;
  readonly pausedAt: string | null;
  readonly pausedAtStatus: 'ok' | 'unavailable';
  readonly recommendation: string | null;
  readonly recommendationSource: 'in-window' | 'widened' | 'none';
  readonly newObservations: number | null;
};

/** Step 4-F's three lists. */
export type AutoClosedLists = {
  readonly closed: readonly {
    readonly issue: number | string;
    readonly newestObservation: string;
  }[];
  readonly keptOpenByHumanReopen: readonly (number | string)[];
  readonly skippedUnreadableDate: readonly (number | string)[];
};

export type DashboardInput = {
  /** The moment the caller is writing this body, as it read it from the clock. */
  readonly updatedAt: string;
  readonly issues: readonly DashboardIssue[];
  readonly awaitingDecision: readonly AwaitingDecisionRow[];
  readonly autoClosed: AutoClosedLists;
  /** Caller-supplied note lines, e.g. "two dashboard issues found". */
  readonly notes?: readonly string[];
  readonly paragraph?: string;
  readonly limit?: number;
};

type TableRow = {
  readonly number: number;
  readonly identity: string;
  readonly tier: Tier;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly occurrences: number;
  readonly fixPrUrl: string | null;
};

// --- reading one issue ------------------------------------------------------

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

/** A date this renderer can order. An unorderable one is left out entirely. */
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
 * Every date that counts toward Occurrences: the body's first observation plus
 * each observation comment's own `Date:` line. The issue's `created_at` /
 * `updated_at` are deliberately not among them — a backfilled observation can
 * predate the issue, and bookkeeping moves `updated_at`.
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
 * marker, human notes) is excluded by construction.
 */
const countOccurrences = (issue: DashboardIssue): number =>
  1 +
  issue.comments.filter((comment) => isObservationComment(comment.body)).length;

/**
 * The last `**Fix PR**: {URL}` line anywhere in the comments, matched per line
 * (with trailing whitespace trimmed) rather than against a whole comment body:
 * real markers are followed by a blank line, `---` and a signature. Forward
 * only — a PR URL mentioned in free text is never a fallback.
 */
const fixPrUrl = (issue: DashboardIssue): string | null => {
  let found: string | null = null;
  for (const comment of issue.comments) {
    for (const rawLine of comment.body.split('\n')) {
      const line = rawLine.replace(/\s+$/, '');
      if (line.startsWith(MARKERS.fixPr)) {
        const url = line.slice(MARKERS.fixPr.length);
        if (url !== '') {
          found = url;
        }
      }
    }
  }
  return found;
};

/** The strongest tier label the issue carries, or `null` if it carries none. */
const strongestTier = (labels: readonly string[]): Tier | null =>
  TIER_ORDER.find((tier) => labels.includes(TIER_LABELS[tier])) ?? null;

const identityOf = (title: string): string =>
  title.startsWith('flaky: ') ? title.slice('flaky: '.length) : title;

const toTableRow = (issue: DashboardIssue): TableRow | null => {
  const tier = strongestTier(issue.labels);
  if (tier == null) {
    // Not an active flaky tracker: the caller decides what to load, and an
    // issue with no tier label has no Tier cell to write.
    return null;
  }
  const dates = [...observationDates(issue)].sort(compareIso);
  return {
    number: issue.number,
    identity: identityOf(issue.title),
    tier,
    firstSeen: dates[0] ?? null,
    lastSeen: dates.at(-1) ?? null,
    occurrences: countOccurrences(issue),
    fixPrUrl: fixPrUrl(issue),
  };
};

/** Tier first (strongest first), then tracking-issue number ascending. */
const buildTableRows = (
  issues: readonly DashboardIssue[],
): readonly TableRow[] =>
  issues
    .map(toTableRow)
    .filter((row): row is TableRow => row != null)
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        a.number - b.number,
    );

// --- rendering the parts ----------------------------------------------------

const link = (url: string): string => `[${url}](${url})`;

const issueRef = (issue: number | string): string => `#${issue}`;

const renderTableRow = (row: TableRow): string =>
  `| ${row.identity} | ${row.tier} | ${row.firstSeen ?? EM_DASH} | ${row.lastSeen ?? EM_DASH} | ${row.occurrences} | ${issueRef(row.number)} | ${row.fixPrUrl == null ? EM_DASH : link(row.fixPrUrl)} |`;

const orderablePausedAt = (row: AwaitingDecisionRow): string | null =>
  row.pausedAtStatus === 'ok' &&
  row.pausedAt != null &&
  isComparable(row.pausedAt)
    ? row.pausedAt
    : null;

/**
 * Oldest `Paused at` first — the longest-unanswered question is the one a human
 * should see at the top. A row whose pause time could not be read sorts last:
 * there is no moment to order it by, and it is a data problem rather than a
 * waiting decision.
 */
const sortAwaiting = (
  rows: readonly AwaitingDecisionRow[],
): readonly AwaitingDecisionRow[] =>
  [...rows].sort((a, b) => {
    // A pause time that cannot be ordered is treated exactly like a missing
    // one: it sorts last instead of throwing, so one unreadable row cannot
    // take the whole body down with it.
    const aTime = orderablePausedAt(a);
    const bTime = orderablePausedAt(b);
    if (aTime == null || bTime == null) {
      return aTime == null ? (bTime == null ? 0 : 1) : -1;
    }
    return compareIso(aTime, bTime);
  });

/**
 * The Recommendation cell is a **verbatim** copy of the line the script read.
 * `awaiting-decision-rows.ts` already writes the `(may be stale) ` prefix into
 * `recommendation` when it had to widen its search, so adding it here would
 * print it twice; `recommendationSource` is carried in the input as the reason
 * for the prefix, not as an instruction to apply one.
 */
const renderAwaitingRow = (row: AwaitingDecisionRow): string => {
  const unavailable = row.pausedAtStatus !== 'ok' || row.pausedAt == null;
  const pausedAt = unavailable ? EM_DASH : (row.pausedAt as string);
  const newObservations =
    unavailable || row.newObservations == null
      ? EM_DASH
      : String(row.newObservations);
  return `| ${issueRef(row.issue)} | ${pausedAt} | ${row.recommendation ?? EM_DASH} | ${newObservations} |`;
};

const renderBulletList = (
  prefix: string,
  issues: readonly (number | string)[],
): string =>
  `${prefix}${issues.length === 0 ? EMPTY_LIST : issues.map(issueRef).join(', ')}`;

const renderAutoClosedSection = (lists: AutoClosedLists): string => {
  const table =
    lists.closed.length === 0
      ? ZERO_STATE.none
      : [
          AUTO_CLOSED_TABLE_HEADER,
          ...[...lists.closed]
            .sort((a, b) => Number(a.issue) - Number(b.issue))
            .map(
              (entry) =>
                `| ${issueRef(entry.issue)} | ${entry.newestObservation} |`,
            ),
        ].join('\n');
  return [
    AUTO_CLOSED_HEADING,
    '',
    table,
    '',
    renderBulletList(KEPT_OPEN_PREFIX, lists.keptOpenByHumanReopen),
    renderBulletList(SKIPPED_PREFIX, lists.skippedUnreadableDate),
  ].join('\n');
};

// --- assembling the body ----------------------------------------------------

type Assembly = {
  readonly tableRows: readonly TableRow[];
  readonly tableTruncated: boolean;
  readonly awaitingRows: readonly AwaitingDecisionRow[];
  readonly awaitingTruncated: boolean;
  readonly notes: readonly string[];
};

/**
 * A truncated table keeps its header and loses rows; it never falls back to
 * the zero-state line, which says "nothing is active" — a different, wrong,
 * fact. The same holds for the awaiting-decision section below.
 */
const renderTableSection = (assembly: Assembly): string => {
  if (assembly.tableRows.length === 0 && !assembly.tableTruncated) {
    return ZERO_STATE.noActiveFlakyTests;
  }
  return [TABLE_HEADER, ...assembly.tableRows.map(renderTableRow)].join('\n');
};

const renderAwaitingSection = (assembly: Assembly): string => {
  const content =
    assembly.awaitingRows.length === 0 && !assembly.awaitingTruncated
      ? ZERO_STATE.noIssuesAwaitingDecision
      : [
          AWAITING_TABLE_HEADER,
          ...assembly.awaitingRows.map(renderAwaitingRow),
        ].join('\n');
  return [AWAITING_HEADING, '', content].join('\n');
};

const assemble = (input: DashboardInput, assembly: Assembly): string => {
  const blocks = [
    TITLE,
    `_Updated: ${input.updatedAt}_`,
    ...assembly.notes,
    input.paragraph ?? DEFAULT_PARAGRAPH,
    renderTableSection(assembly),
    renderAwaitingSection(assembly),
    renderAutoClosedSection(input.autoClosed),
    `---\n${SIGNATURES.claudeCode}`,
  ];
  return blocks.join('\n\n');
};

const plural = (count: number): string => (count === 1 ? '' : 's');

const tableNote = (dropped: number, limit: number): string =>
  `_Note: ${dropped} table row${plural(dropped)} truncated from the bottom of the order to fit the ${limit}-character body limit; the rows kept are the strongest tiers, in the same order._`;

const awaitingNote = (dropped: number, limit: number): string =>
  `_Note: ${dropped} ${AWAITING_HEADING.replace('## ', '')} row${plural(dropped)} truncated from the bottom, oldest \`Paused at\` kept first, to fit the ${limit}-character body limit._`;

/**
 * The body that fits, found by shortening one list at a time and re-measuring
 * the **whole** body each time — the note lines truncation adds are part of
 * what has to fit, so measuring the table alone would undercount.
 *
 * Table rows go first, from the bottom of their order. Only if the two
 * sections alone still exceed the limit do `## Awaiting human decision` rows
 * go, also from the bottom, which keeps the oldest `Paused at` — the
 * longest-unanswered question. Neither section, and neither section's
 * zero-state line, is ever dropped.
 */
const fitToLimit = (
  input: DashboardInput,
  rows: readonly TableRow[],
  awaiting: readonly AwaitingDecisionRow[],
  limit: number,
): string => {
  const callerNotes = input.notes ?? [];
  const full = assemble(input, {
    tableRows: rows,
    tableTruncated: false,
    awaitingRows: awaiting,
    awaitingTruncated: false,
    notes: callerNotes,
  });
  if (full.length <= limit) {
    return full;
  }

  for (let kept = rows.length - 1; kept >= 0; kept -= 1) {
    const body = assemble(input, {
      tableRows: rows.slice(0, kept),
      tableTruncated: true,
      awaitingRows: awaiting,
      awaitingTruncated: false,
      notes: [...callerNotes, tableNote(rows.length - kept, limit)],
    });
    if (body.length <= limit) {
      return body;
    }
  }

  let shortest = assemble(input, {
    tableRows: [],
    tableTruncated: rows.length > 0,
    awaitingRows: awaiting,
    awaitingTruncated: false,
    notes:
      rows.length > 0
        ? [...callerNotes, tableNote(rows.length, limit)]
        : callerNotes,
  });
  for (let kept = awaiting.length - 1; kept >= 0; kept -= 1) {
    const notes = [
      ...callerNotes,
      ...(rows.length > 0 ? [tableNote(rows.length, limit)] : []),
      awaitingNote(awaiting.length - kept, limit),
    ];
    shortest = assemble(input, {
      tableRows: [],
      tableTruncated: rows.length > 0,
      awaitingRows: awaiting.slice(0, kept),
      awaitingTruncated: true,
      notes,
    });
    if (shortest.length <= limit) {
      return shortest;
    }
  }
  // Even with no row at all the fixed parts exceed the limit. Returning the
  // shortest body there is, rather than a partial one, keeps both sections and
  // their zero-state lines intact, which item 6 puts above fitting.
  return shortest;
};

export const render = (input: DashboardInput): string => {
  const limit = input.limit ?? BODY_CHAR_LIMIT;
  return fitToLimit(
    input,
    buildTableRows(input.issues),
    sortAwaiting(input.awaitingDecision),
    limit,
  );
};
