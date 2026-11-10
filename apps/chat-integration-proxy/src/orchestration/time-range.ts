// Turning the `range` value a `keep` command collected into the `TimeRange`
// `PlatformFacade.fetchHistory` takes.
//
// It is one function shared by both ways that value can arrive -- a modal
// field and a follow-up answer -- which is what task 4.4's hand-off (a) asks
// for: `ArgumentCollector` hands every field back as a plain string and
// deliberately builds no `TimeRange`, so the single place that interprets it
// is here, on the side that calls `fetchHistory`.
//
// **Anything it cannot read WHOLE is refused.** The command line fills fields
// positionally and `range` takes only the first word (task 4.4's hand-off
// (b-2)), so `keep 2026-09-01 to 2026-09-03 /memo` would otherwise leave
// `range` as `2026-09-01` and quietly import a different span than the user
// asked for. A refusal the user can see is the whole point of this rule.
import type { TimeRange } from '../types/index.js';

/** What a caller shows when `parseTimeRange` refuses. */
export const TIME_RANGE_USAGE =
  '取り込む範囲は `2026-09-01..2026-09-03` のように、開始と終了を `..` でつないだ 1 つの語で指定してください（1 日分なら `2026-09-01` だけでも構いません）。空白を含む書き方はできません。';

const SEPARATOR = '..';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A whole date, with no time of day written out. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One endpoint of the range. A bare date is read as UTC midnight -- the same
 * reading `Date` itself gives `YYYY-MM-DD`, and the only one available: an
 * `Invocation` carries no time zone, and neither does `ChannelRef`.
 */
const instantOf = (text: string): Date | null => {
  if (text === '') return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseTimeRange = (text: string): TimeRange | null => {
  const trimmed = text.trim();
  // A range is one word by construction; anything else was cut short by the
  // positional parse and must not be guessed at.
  if (trimmed === '' || /\s/.test(trimmed)) return null;

  if (!trimmed.includes(SEPARATOR)) {
    // A single day, taken as that whole day. Only the date-only form: a bare
    // instant would describe a range of zero length.
    if (!DATE_ONLY.test(trimmed)) return null;
    const since = instantOf(trimmed);
    return since == null
      ? null
      : { since, until: new Date(since.getTime() + DAY_MS) };
  }

  const [start, end, ...rest] = trimmed.split(SEPARATOR);
  if (rest.length > 0) return null;
  const since = instantOf(start ?? '');
  const until = instantOf(end ?? '');
  if (since == null || until == null) return null;
  // An end at or before the start spans nothing, so it would import nothing
  // and report "no messages in that range" -- a misleading answer to what is
  // really a mistyped range.
  return until.getTime() <= since.getTime() ? null : { since, until };
};
