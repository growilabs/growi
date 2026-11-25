import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { apiV3ErrorCode } from '~/interfaces/errors/v3-error';
import { toArrayIfNot } from '~/utils/array-utils';

// Errors the server answers with as soon as the request arrives, before the
// fixed-delay password reset processing starts.
const IMMEDIATE_REJECTION_MESSAGE_KEYS = {
  [forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE]:
    'forgot_password.password_reset_disabled',
  [apiV3ErrorCode.VALIDATION_FAILED]: 'forgot_password.invalid_input_format',
} as const;

type PasswordResetFailureMessageKey =
  | (typeof IMMEDIATE_REJECTION_MESSAGE_KEYS)[keyof typeof IMMEDIATE_REJECTION_MESSAGE_KEYS]
  | 'forgot_password.request_failed';

const errorCodesOf = (err: unknown): unknown[] =>
  toArrayIfNot(err).map((e) =>
    typeof e === 'object' && e != null && 'code' in e ? e.code : undefined,
  );

const isImmediateRejectionCode = (
  code: unknown,
): code is keyof typeof IMMEDIATE_REJECTION_MESSAGE_KEYS =>
  typeof code === 'string' &&
  Object.hasOwn(IMMEDIATE_REJECTION_MESSAGE_KEYS, code);

/**
 * Any other failure, including one without an error code (a network error,
 * a plain 429, a proxy's 502 page), gets the generic retry guidance.
 */
export const resolvePasswordResetFailureMessageKey = (
  err: unknown,
): PasswordResetFailureMessageKey => {
  const code = errorCodesOf(err).find(isImmediateRejectionCode);
  return code == null
    ? 'forgot_password.request_failed'
    : IMMEDIATE_REJECTION_MESSAGE_KEYS[code];
};
