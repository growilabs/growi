import ExtensibleCustomError from 'extensible-custom-error';

export const G2GTransferErrorCode = {
  INVALID_TRANSFER_KEY_STRING: 'INVALID_TRANSFER_KEY_STRING',
  FAILED_TO_RETRIEVE_GROWI_INFO: 'FAILED_TO_RETRIEVE_GROWI_INFO',
  FAILED_TO_RETRIEVE_FILE_METADATA: 'FAILED_TO_RETRIEVE_FILE_METADATA',
} as const;

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
