import type {
  CollectionName,
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

/**
 * A composite unique key's label joins its field names with "+" (see `UniqueKeySpec.label`
 * in detect-unique-conflicts.ts, e.g. `"providerType+accountId"`), and its reported value
 * is the `JSON.stringify`'d array of those fields' values in the same order
 * (`toReportedValue`). This is detected structurally from the label/value shape, not by
 * collection name, so a future composite key needs no change here.
 */
const isCompositeLabel = (field: string): boolean => field.includes('+');

/**
 * Renders one conflicting field/value pair.
 *
 * A single-field key is shown as before (`field "value"`). A composite key is
 * decomposed back into its individual field=value pairs so an operator can tell which
 * value belongs to which field, instead of reading an opaque JSON-stringified array
 * behind nested quotes. Falls back to the generic quoted form if the value does not
 * decompose as expected, so identifying information is never dropped.
 */
const describeConflictDetail = (conflict: UniqueFieldConflict): string => {
  if (!isCompositeLabel(conflict.field)) {
    return `${conflict.field} "${conflict.value}"`;
  }

  const fieldNames = conflict.field.split('+');

  let values: unknown;
  try {
    values = JSON.parse(conflict.value);
  } catch {
    values = null;
  }

  if (!Array.isArray(values) || values.length !== fieldNames.length) {
    return `${conflict.field} "${conflict.value}"`;
  }

  const pairs = fieldNames
    .map((fieldName, index) => `${fieldName}=${values[index]}`)
    .join(', ');
  return `${conflict.field} (${pairs})`;
};

const describeConflicts = (
  collection: CollectionName,
  conflicts: readonly UniqueFieldConflict[],
): string => {
  if (conflicts.length === 0) {
    return `${collection}: no conflicts`;
  }

  const samples = conflicts.slice(0, CONFLICT_SAMPLE_LIMIT);
  const quoted = samples.map(describeConflictDetail).join(', ');
  const remaining = conflicts.length - samples.length;
  const remainder = remaining > 0 ? `, and ${remaining} more` : '';
  const noun = conflicts.length === 1 ? 'conflict' : 'conflicts';

  return `${collection}: ${conflicts.length} ${noun} (${quoted}${remainder})`;
};

/**
 * Renders a conflict report as the operator-facing message of the abort.
 *
 * It answers "which kind conflicted, how many, and on which field with which value"
 * (requirements 3.1, 3.2) while keeping the quoted values down to a sample.
 *
 * Walks `conflictsByCollection` generically (insertion order), so adding a 5th
 * collection to the report never requires a change here: a collection this module has
 * never heard of is described purely from its name and conflict array. A collection
 * absent from the Map (not part of the transfer, per detect-unique-conflicts.ts) is
 * simply not iterated over and gets no section; a collection present with zero
 * conflicts (checked and found clean) still gets an explicit "no conflicts" section,
 * matching the pre-existing users/usergroups behavior.
 *
 * Meant to be called for a report that has conflicts; a report without any yields a
 * summary that says so rather than claiming a conflict.
 */
export const summarizeUniqueConflicts = (
  report: UniqueConflictReport,
): string => {
  const sections = [...report.conflictsByCollection.entries()].map(
    ([collection, conflicts]) => describeConflicts(collection, conflicts),
  );

  const body = sections.length > 0 ? ` ${sections.join('. ')}.` : '';
  return `${OPENING}${body}`;
};
