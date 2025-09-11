export const V5ConversionErrCode = {
  GRANT_INVALID: 'GrantInvalid',
  PAGE_NOT_FOUND: 'PageNotFound',
  DUPLICATE_PAGES_FOUND: 'DuplicatePagesFound',
  FORBIDDEN: 'Forbidden',
} as const;

export type V5ConversionErrCode =
  (typeof V5ConversionErrCode)[keyof typeof V5ConversionErrCode];
