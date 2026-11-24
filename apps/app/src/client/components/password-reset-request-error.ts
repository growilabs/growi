import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { rateLimitErrorCode } from '~/interfaces/errors/rate-limit';
import { apiV3ErrorCode } from '~/interfaces/errors/v3-error';
import { toArrayIfNot } from '~/utils/array-utils';

// Errors the server answers with as soon as the request arrives, before the
// fixed-delay password reset processing starts.
const IMMEDIATE_REJECTION_MESSAGE_KEYS = {
  [forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE]:
    'forgot_password.password_reset_disabled',
  [rateLimitErrorCode.TOO_MANY_REQUESTS]: 'forgot_password.too_many_requests',
  [apiV3ErrorCode.VALIDATION_FAILED]: 'forgot_password.invalid_input_format',
} as const;

type ImmediateRejectionMessageKey =
  (typeof IMMEDIATE_REJECTION_MESSAGE_KEYS)[keyof typeof IMMEDIATE_REJECTION_MESSAGE_KEYS];

const errorCodesOf = (err: unknown): unknown[] =>
  toArrayIfNot(err).map((e) =>
    typeof e === 'object' && e != null && 'code' in e ? e.code : undefined,
  );

const isImmediateRejectionCode = (
  code: unknown,
): code is keyof typeof IMMEDIATE_REJECTION_MESSAGE_KEYS =>
  typeof code === 'string' &&
  Object.hasOwn(IMMEDIATE_REJECTION_MESSAGE_KEYS, code);

export const resolveImmediateRejectionMessageKey = (
  err: unknown,
): ImmediateRejectionMessageKey | null => {
  const code = errorCodesOf(err).find(isImmediateRejectionCode);
  return code == null ? null : IMMEDIATE_REJECTION_MESSAGE_KEYS[code];
};

export const isPasswordResetRequestFailure = (err: unknown): boolean =>
  errorCodesOf(err).includes(
    forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
  );
