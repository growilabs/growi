export const LoginErrorCode = {
  PROVIDER_DUPLICATED_USERNAME_EXCEPTION:
    'provider-duplicated-username-exception',
} as const;

export type LoginErrorCode =
  (typeof LoginErrorCode)[keyof typeof LoginErrorCode];
