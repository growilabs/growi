import ExtensibleCustomError from 'extensible-custom-error';

import type { V5ConversionErrCode } from '~/interfaces/errors/v5-conversion-error';

export class V5ConversionError extends ExtensibleCustomError {
  readonly id = 'V5ConversionError';

  code!: V5ConversionErrCode;

  constructor(message: string, code: V5ConversionErrCode) {
    super(message);
    this.code = code;
  }
}

export const isV5ConversionError = (err: any): err is V5ConversionError => {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  if (err instanceof V5ConversionError) {
    return true;
  }

  return err?.id === 'V5ConversionError';
};
