/**
 * ISO-8601 (UTC) arithmetic and comparison, replacing `date -u -d` and the
 * shell's string comparisons.
 *
 * Every function rejects anything that is not a fixed-width UTC timestamp.
 * `date -d ""` succeeded silently and resolved to today at midnight, and
 * `new Date('2026-09-16')` does the same thing for a date-only string; both
 * turn "this value was missing" into a plausible-looking answer, which is the
 * failure this module exists to prevent.
 */

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const toEpochMs = (iso: string): number => {
  if (!ISO_UTC.test(iso)) {
    throw new Error(
      `not a fixed-width ISO-8601 UTC timestamp: ${JSON.stringify(iso)}`,
    );
  }
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) {
    throw new Error(`not a real instant: ${JSON.stringify(iso)}`);
  }
  return epochMs;
};

/** Second-precision UTC, the form GitHub uses for `created_at`. */
const toIsoSeconds = (epochMs: number): string =>
  `${new Date(epochMs).toISOString().slice(0, 19)}Z`;

/** -1 when `a` is older, 1 when `a` is newer, 0 for the same instant. */
export const compareIso = (a: string, b: string): number => {
  const left = toEpochMs(a);
  const right = toEpochMs(b);
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
};

/**
 * `iso` minus `seconds`, floored to the second so the result stays comparable,
 * as a plain string, against GitHub timestamps.
 */
export const minusSeconds = (iso: string, seconds: number): string => {
  if (!Number.isInteger(seconds)) {
    throw new Error(`seconds must be a whole number, got ${seconds}`);
  }
  return toIsoSeconds(toEpochMs(iso) - seconds * 1000);
};

/** Whole days elapsed from `a` to `b`, truncated, negative when `b` is older. */
export const daysBetween = (a: string, b: string): number =>
  Math.trunc((toEpochMs(b) - toEpochMs(a)) / 86_400_000);
