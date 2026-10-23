export interface PasswordHashFormatCounts {
  /** passwordHash only (fully migrated) */
  readonly upgradedOnly: number;
  /** both fields present — the deletion target */
  readonly both: number;
  /** password only (not migrated), split by user status */
  readonly legacyOnly: {
    readonly active: number;
    readonly nonActive: number;
  };
  /** neither field */
  readonly noPassword: number;
}

export interface PasswordHashStatusResponse {
  readonly counts: PasswordHashFormatCounts;
}

export interface DeleteLegacyPasswordsResponse {
  readonly unsetCount: number;
}
