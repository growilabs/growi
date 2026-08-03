// Single source of truth for which fields the unique-conflict detection targets,
// kept in sync with the MongoDB unique index definitions (models/user, models/user-group).
export type UserUniqueField = 'username' | 'email' | 'slackMemberId';
export type GroupUniqueField = 'name';
export type UniqueField = UserUniqueField | GroupUniqueField;

// Minimal document shape extracted from the archive / existing data for comparison.
// Sparse unique fields (email, slackMemberId) may be absent, so they are optional/nullable.
export interface UserUniqueFields {
  _id: string;
  username?: string | null;
  email?: string | null;
  slackMemberId?: string | null;
}

export interface GroupUniqueFields {
  _id: string;
  name?: string | null;
}

export interface UniqueFieldConflict {
  collection: 'users' | 'usergroups';
  field: UniqueField;
  value: string;
  archiveId: string;
  existingId: string;
}

export interface UniqueConflictReport {
  userConflicts: UniqueFieldConflict[];
  groupConflicts: UniqueFieldConflict[];
}

export const hasConflicts = (report: UniqueConflictReport): boolean =>
  report.userConflicts.length > 0 || report.groupConflicts.length > 0;

// Sparse unique fields treat null/undefined/empty-string as "not set". Two documents
// that both lack the value do not violate a unique index, so they must not be compared.
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Pure comparison: enumerates every archive document whose unique field value matches
 * an existing document's value under a different `_id`. Receives both datasets as
 * arguments (does not import or fetch them) so it stays reusable and unit-testable.
 */
export function collectConflicts<T extends { _id: string }>(
  collection: 'users' | 'usergroups',
  archiveDocs: readonly T[],
  existingDocs: readonly T[],
  fields: readonly (UniqueField & keyof T)[],
): UniqueFieldConflict[] {
  const conflicts: UniqueFieldConflict[] = [];

  for (const field of fields) {
    // Index existing docs by value once per field to avoid an N+1 scan per archive doc.
    const existingIdByValue = new Map<string, string>();
    for (const existingDoc of existingDocs) {
      const value = existingDoc[field];
      if (!isNonEmptyString(value)) continue;
      existingIdByValue.set(value, existingDoc._id);
    }

    for (const archiveDoc of archiveDocs) {
      const value = archiveDoc[field];
      if (!isNonEmptyString(value)) continue;

      const existingId = existingIdByValue.get(value);
      if (existingId == null || existingId === archiveDoc._id) continue;

      conflicts.push({
        collection,
        field,
        value,
        archiveId: archiveDoc._id,
        existingId,
      });
    }
  }

  return conflicts;
}
