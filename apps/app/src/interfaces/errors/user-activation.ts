export const UserActivationErrorCode = {
  TOKEN_NOT_FOUND: 'token-not-found',
  INVALID_TOKEN: 'token-is-invalid',
  USER_REGISTRATION_ORDER_IS_NOT_APPROPRIATE:
    'user-registration-order-is-not-appropriate',
} as const;

export type UserActivationErrorCode =
  (typeof UserActivationErrorCode)[keyof typeof UserActivationErrorCode];
