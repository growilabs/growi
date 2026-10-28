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

export interface PasswordHashUnmigratedUser {
  readonly _id: string;
  readonly username: string;
  readonly email: string | null;
  /** ISO 8601. null when the user has never logged in */
  readonly lastLoginAt: string | null;
}

export interface PasswordHashUnmigratedUsersResponse {
  readonly users: readonly PasswordHashUnmigratedUser[];
  readonly totalCount: number;
  readonly page: number;
  readonly limit: number;
}
