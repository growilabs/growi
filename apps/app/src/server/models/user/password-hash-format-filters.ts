import type { Document, Filter } from 'mongodb';

import { UserStatus } from './conts';

/**
 * The MongoDB filters that classify a user document — the single source of truth
 * shared by the status migration, the cleanup script, and the downgrade-prep
 * script: four by which credential fields the document holds
 * (upgradedOnly / both / legacyOnly / noPassword), plus an active/non-active
 * pair used to scope the lifecycle scripts to users who can actually be served
 * by the recovery flows.
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
 * Users who can still log in — and are therefore the only ones whose credential
 * format can still change on its own (lazy migration on login), and the only ones
 * a password-reset email can actually recover: forgot-password rejects every
 * non-ACTIVE user on both POST and PUT (`routes/apiv3/forgot-password.js`).
 *
 * The administrative scripts scope their *actionable* set with this: a
 * legacyOnly user who can never log in must not block the cleanup forever, and a
 * upgradedOnly user who can never reset must not have their `passwordHash`
 * removed (that would be a permanent lockout).
 */
export const activeUserFilter: Filter<Document> = {
  status: UserStatus.STATUS_ACTIVE,
};
/** The complement of {@link activeUserFilter} (registered / suspended / deleted / invited). */
export const nonActiveUserFilter: Filter<Document> = {
  status: { $ne: UserStatus.STATUS_ACTIVE },
};

/**
 * AND-combine an optional base scope (e.g. a test marker) with one or more
 * classification filters. An empty base returns a single filter unchanged
 * (production: whole collection), so passing no base preserves existing
 * behavior; a non-empty base narrows every classification query to that subset
 * (used by the integ tests to scope counts/writes to their marker-seeded
 * fixtures, so they never touch the shared `users` collection).
 */
export const scopeFilter = (
  base: Filter<Document>,
  ...filters: Filter<Document>[]
): Filter<Document> => {
  const combined =
    base != null && Object.keys(base).length > 0 ? [base, ...filters] : filters;
  // MongoDB rejects an empty `$and`, so an unscoped call with no filters must
  // degrade to "match everything" rather than build one.
  if (combined.length === 0) {
    return {};
  }
  return combined.length === 1 ? combined[0] : { $and: combined };
};
