export const forgotPasswordErrorCode = {
  PASSWORD_RESET_IS_UNAVAILABLE: 'password-reset-is-unavailable',
  TOKEN_NOT_FOUND: 'token-not-found',
  PASSWORD_RESET_ORDER_IS_NOT_APPROPRIATE:
    'password-reset-order-is-not-appropriate',
} as const;

export type forgotPasswordErrorCode =
  (typeof forgotPasswordErrorCode)[keyof typeof forgotPasswordErrorCode];
