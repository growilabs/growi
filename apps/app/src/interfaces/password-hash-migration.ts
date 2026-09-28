/**
 * Types for the admin-facing view of the SHA-256 -> scrypt password-hash migration.
 *
 * The migration keeps credentials in two mutually-exclusive fields (legacy `password`
 * = SHA-256, `passwordHash` = scrypt), so every user falls into exactly one of four
 * formats. An administrator needs that distribution to decide whether the (destructive)
 * cleanup can run yet.
 */

export interface IPasswordHashFormatDistribution {
  /** fully migrated: scrypt only. */
  upgradedOnly: number;
  /** migrated but the legacy hash is still present — what the cleanup removes. */
  both: number;
  /** not yet migrated: legacy SHA-256 only. */
  legacyOnly: number;
  /**
   * ACTIVE subset of `legacyOnly`. Only these block the cleanup: a non-active user
   * cannot be compelled to log in, so counting them would make the cleanup
   * unreachable indefinitely.
   */
  legacyOnlyActive: number;
  /** non-ACTIVE subset of `legacyOnly` — reported for visibility, never blocking. */
  legacyOnlyNonActive: number;
  /** no usable password (external-auth-only, not-yet-activated, or scrubbed). */
  noPassword: number;
}

export interface IResPasswordHashMigrationStatus {
  distribution: IPasswordHashFormatDistribution;
  /** true when no ACTIVE `legacyOnly` user remains, so the cleanup would not abort. */
  isCleanupRunnable: boolean;
  /** true when no `both` user remains, i.e. there is nothing left to remove. */
  isCleanupCompleted: boolean;
}

export interface IResPasswordHashCleanup {
  /** number of documents the legacy `password` field was removed from. */
  unset: number;
}
