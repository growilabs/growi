import type { ExternalAccountLoginError } from '~/models/vo/external-account-login-error';

export type IExternalAccountLoginError = ExternalAccountLoginError;

// type guard
export const isExternalAccountLoginError = (
  args: any,
): args is IExternalAccountLoginError => {
  return (args as IExternalAccountLoginError).message != null;
};
