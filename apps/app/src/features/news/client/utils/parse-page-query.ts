/**
 * Parse a `?page=N` query into a positive integer page number. Falls back to 1
 * for missing / non-numeric / non-positive input to keep URL manipulation safe.
 */
export const parsePageQuery = (
  value: string | string[] | undefined,
): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};
