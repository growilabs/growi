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
