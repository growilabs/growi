import { ExtensibleCustomError } from '~/server/util/extensible-custom-error';

export const G2GTransferErrorCode = {
  INVALID_TRANSFER_KEY_STRING: 'INVALID_TRANSFER_KEY_STRING',
  FAILED_TO_RETRIEVE_GROWI_INFO: 'FAILED_TO_RETRIEVE_GROWI_INFO',
  FAILED_TO_RETRIEVE_FILE_METADATA: 'FAILED_TO_RETRIEVE_FILE_METADATA',
  DATA_CONFLICT: 'DATA_CONFLICT',
} as const;

/**
 * apiv3 error code the receive route answers with when it aborts an import because the
 * archive collides with data that already exists in the destination GROWI.
 *
 * It lives here as the single source of truth because two sides depend on the exact
 * string: the receive route puts it on the wire, and the pusher matches the receiver's
 * response body against it to tell a data conflict from any other transfer failure.
 * Spelling it out twice would let the two drift apart silently.
 */
export const G2G_DATA_CONFLICT_ERROR_CODE = 'growi_data_conflict';

/**
 * apiv3 error code the receive route answers with when the request names a collection the
 * transfer is not allowed to carry (see non-transferable-collections.ts).
 *
 * A normal transfer never reaches it: the push route drops those collections before the
 * archive is built. It is the safety net for anything that reaches the receive route by
 * another path, which is why it refuses the request outright instead of dropping the
 * collection the way the push side does — at this point the archive has already been
 * built around a collection list that should not have contained it.
 */
export const G2G_PROTECTED_COLLECTION_ERROR_CODE =
  'protected_collection_included';

/**
 * apiv3 error code the receive route answers with when another import is already running
 * on the destination.
 *
 * Both sides depend on the exact string, like {@link G2G_DATA_CONFLICT_ERROR_CODE}: the
 * receive route puts it on the wire and the pusher matches it so the operator is told the
 * destination is busy rather than shown a generic failure.
 */
export const G2G_IMPORT_IN_PROGRESS_ERROR_CODE = 'import_already_in_progress';

/**
 * apiv3 error code the receive route answers with when the request's import-method
 * assignment mixes replacing some collections with appending to others.
 *
 * `isCoherentOptionsMap` (`models/admin/g2g-transfer-preset.ts`) is the single judge of
 * that question; the route only acts on its answer and never inspects which collection or
 * mode is involved. Today's legacy G2G screen can still build a mixed request (it only
 * restricts `configs` / `users` / `pages`, so e.g. `usergroups` can be set to replace
 * while the rest stay append) — task 10.1 narrows that screen so it no longer can. This
 * guard stays on as the backstop for anything that reaches the receive route without
 * going through that screen at all — an automation script or a modified client posting
 * to this endpoint directly. Run before anything is unzipped or written, so a refused
 * request leaves the destination untouched.
 */
export const G2G_MIXED_IMPORT_MODES_ERROR_CODE = 'mixed_import_modes';

/**
 * apiv3 error code the receive route answers with when the transfer key on the request
 * is missing, expired, or fails to parse.
 *
 * Both sides depend on the exact string, like {@link G2G_DATA_CONFLICT_ERROR_CODE}.
 */
export const G2G_INVALID_TRANSFER_KEY_ERROR_CODE = 'invalid_transfer_key';

/**
 * apiv3 error code the receive route answers with when the request body's JSON fields
 * (`collections` / `optionsMap` / `uploadConfigs`) fail to parse.
 */
export const G2G_PARSE_FAILED_ERROR_CODE = 'parse_failed';

/**
 * apiv3 error code the receive route answers with when the uploaded archive fails to
 * unzip or its `meta.json` fails to parse.
 */
export const G2G_VALIDATION_FAILED_ERROR_CODE = 'validation_failed';

/**
 * apiv3 error code the receive route answers with when the archive's GROWI version does
 * not match the destination's.
 */
export const G2G_VERSION_INCOMPATIBLE_ERROR_CODE = 'version_incompatible';

/**
 * apiv3 error code the receive route answers with when the request's import-method map
 * cannot be turned into `ImportSettings` for one or more collections.
 */
export const G2G_IMPORT_SETTINGS_INVALID_ERROR_CODE = 'import_settings_invalid';

/**
 * apiv3 error code the receive route answers with when it could not determine whether
 * the archive conflicts with the destination's existing data (as opposed to detecting an
 * actual conflict, which is {@link G2G_DATA_CONFLICT_ERROR_CODE}). Kept distinct from a
 * network failure so the operator is told the receive route did run and refused to guess
 * — see issue #10151.
 */
export const G2G_CONFLICT_DETECTION_FAILED_ERROR_CODE =
  'conflict_detection_failed';

/**
 * apiv3 error code the receive route answers with when a collection failed to write to
 * MongoDB for a reason other than a detected unique-constraint conflict.
 */
export const G2G_MONGO_COLLECTION_IMPORT_FAILURE_ERROR_CODE =
  'mongo_collection_import_failure';

export type G2GTransferErrorCode =
  (typeof G2GTransferErrorCode)[keyof typeof G2GTransferErrorCode];

export class G2GTransferError extends ExtensibleCustomError {
  readonly id = 'G2GTransferError';

  code!: G2GTransferErrorCode;

  constructor(message: string, code: G2GTransferErrorCode) {
    super(message);
    this.code = code;
  }
}

export const isG2GTransferError = (err: any): err is G2GTransferError => {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  if (err instanceof G2GTransferError) {
    return true;
  }

  return err?.id === 'G2GTransferError';
};
