import type { Document, Filter } from 'mongodb';

/**
 * The four MongoDB filters that classify a user document by which credential
 * fields it holds — the single source of truth shared by the status migration,
 * the cleanup script, and the downgrade-prep script.
 *
 * A credential field (`password` = legacy SHA-256, `passwordHash` = scrypt)
 * counts as PRESENT only when it exists and holds a non-empty value. Deleted
 * users are scrubbed (statusDelete), and older deleted docs may still carry
 * `password: ''` on disk, so an empty string / null MUST read as ABSENT —
 * otherwise deleted users are mis-counted as `legacyOnly`, which makes the
 * cleanup script abort forever.
 */
const present = (field: string): Filter<Document> => ({
  [field]: { $exists: true, $nin: [null, ''] },
});
const absent = (field: string): Filter<Document> => ({
  $or: [{ [field]: { $exists: false } }, { [field]: { $in: [null, ''] } }],
});

/** fully migrated: scrypt only (no usable legacy password). */
export const upgradedOnlyFilter: Filter<Document> = {
  $and: [present('passwordHash'), absent('password')],
};
/** in progress: both credentials present. */
export const bothFilter: Filter<Document> = {
  $and: [present('passwordHash'), present('password')],
};
/** not migrated: legacy password only (no scrypt hash). */
export const legacyOnlyFilter: Filter<Document> = {
  $and: [absent('passwordHash'), present('password')],
};
/** no usable password (external-auth-only, not-yet-activated, or scrubbed). */
export const noPasswordFilter: Filter<Document> = {
  $and: [absent('passwordHash'), absent('password')],
};

/**
 * AND-combine an optional base scope (e.g. a test marker) with a format filter.
 * An empty base returns the format filter unchanged (production: whole
 * collection), so passing no base preserves existing behavior; a non-empty base
 * narrows every classification query to that subset (used by the integ tests to
 * scope counts/writes to their marker-seeded fixtures, so they never touch the
 * shared `users` collection).
 */
export const scopeFilter = (
  base: Filter<Document>,
  formatFilter: Filter<Document>,
): Filter<Document> =>
  base != null && Object.keys(base).length > 0
    ? { $and: [base, formatFilter] }
    : formatFilter;
