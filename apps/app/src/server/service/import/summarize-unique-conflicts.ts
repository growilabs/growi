import type {
  UniqueConflictReport,
  UniqueFieldConflict,
} from './detect-unique-conflicts';

/**
 * How many conflicting field/value pairs are quoted per collection.
 *
 * The conflicting values are user data (e-mail addresses, slack member ids), and this
 * summary travels to the source GROWI and into its admin UI, so the notification carries
 * representative examples plus a total count instead of the whole list.
 */
export const CONFLICT_SAMPLE_LIMIT = 3;

const OPENING =
  'The transfer data conflicts with data that already exists in this GROWI, so no collection was imported.';

const describeConflicts = (
  label: string,
  conflicts: readonly UniqueFieldConflict[],
): string => {
  if (conflicts.length === 0) {
    return `${label}: no conflicts`;
  }

  const samples = conflicts.slice(0, CONFLICT_SAMPLE_LIMIT);
  const quoted = samples
    .map((conflict) => `${conflict.field} "${conflict.value}"`)
    .join(', ');
  const remaining = conflicts.length - samples.length;
  const remainder = remaining > 0 ? `, and ${remaining} more` : '';
  const noun = conflicts.length === 1 ? 'conflict' : 'conflicts';

  return `${label}: ${conflicts.length} ${noun} (${quoted}${remainder})`;
};

/**
 * Renders a conflict report as the operator-facing message of the abort.
 *
 * It answers "which kind conflicted, how many, and on which field with which value"
 * (requirements 3.1, 3.2) while keeping the quoted values down to a sample.
 *
 * Meant to be called for a report that has conflicts; a report without any yields a
 * summary that says so rather than claiming a conflict.
 */
export const summarizeUniqueConflicts = (
  report: UniqueConflictReport,
): string => {
  const users = describeConflicts('users', report.userConflicts);
  const groups = describeConflicts('usergroups', report.groupConflicts);

  return `${OPENING} ${users}. ${groups}.`;
};
