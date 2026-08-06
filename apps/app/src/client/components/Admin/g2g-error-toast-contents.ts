/**
 * `admin:g2gError` keys whose `message` carries operator-facing detail beyond
 * the translated heading (requirements 3.1, 3.2 — the data-conflict message
 * is a dynamically generated summary of which collection/field/value
 * conflicted, not a restatement of the heading). Every other key's `message`
 * is a hardcoded English restatement of its heading (see
 * `service/g2g-transfer.ts`'s `GENERIC_ARCHIVE_POST_ERROR_EVENT` and
 * siblings), so it is dropped to avoid a duplicate toast.
 */
export const KEYS_WITH_DETAIL_MESSAGE: readonly string[] = [
  'admin:g2g:error_data_conflict',
  // Requirement 2.8 — the operator has to be told *which* collections were left out, and
  // that list is built by the destination, so the heading alone cannot carry it.
  'admin:g2g:error_partial_import',
  // Same reason: the `message` is the receiver's own list of the collections it refused
  // ("These collections must not be transferred: …"), and that list is the only thing
  // that identifies which side of the transfer disagrees about what may be carried.
  'admin:g2g:error_protected_collection',
];

/**
 * Builds the toast content(s) for an `admin:g2gError` event.
 *
 * Deciding by comparing `message` against the translated heading text does
 * not work: `message` is always the pusher's hardcoded English string, but
 * `translatedHeading` is whatever the active locale resolves it to. Several
 * locales (e.g. ja_JP, fr_FR, ko_KR) already translate these headings, so the
 * two strings never match there, and every non-conflict error would double
 * into two toasts (one translated, one raw English) — a regression from the
 * single toast shown before this feature. Deciding by `key` membership
 * instead makes the choice independent of translation content.
 */
export const buildG2GErrorToastContents = (
  key: string,
  translatedHeading: string,
  message: string,
): Error[] =>
  KEYS_WITH_DETAIL_MESSAGE.includes(key)
    ? [new Error(translatedHeading), new Error(message)]
    : [new Error(translatedHeading)];
