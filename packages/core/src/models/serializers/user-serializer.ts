import { Document } from 'mongoose';

import { isPopulated, isRef, type Ref } from '../../interfaces/common';
import type { IUser } from '../../interfaces/user';

export type IUserSerializedSecurely<U extends IUser> = Omit<
  U,
  'password' | 'apiToken' | 'email'
> & { email?: string };

export const omitInsecureAttributes = <U extends IUser>(
  user: U,
): IUserSerializedSecurely<U> => {
  const leanDoc = user instanceof Document ? user.toObject<U>() : user;

  const {
    // biome-ignore lint/correctness/noUnusedVariables: ignore
    password,
    // biome-ignore lint/correctness/noUnusedVariables: ignore
    apiToken,
    email,
    ...rest
  } = leanDoc;

  const secureUser: IUserSerializedSecurely<U> = rest;

  // omit email
  if (secureUser.isEmailPublished) {
    secureUser.email = email;
  }

  return secureUser;
};

export function serializeUserSecurely<U extends IUser>(
  user?: U,
): IUserSerializedSecurely<U>;
export function serializeUserSecurely<U extends IUser>(
  user?: Ref<U>,
): Ref<IUserSerializedSecurely<U>>;
export function serializeUserSecurely<U extends IUser>(
  user?: U | Ref<U>,
): undefined | IUserSerializedSecurely<U> | Ref<IUserSerializedSecurely<U>> {
  if (user == null) return user;

  if (isRef(user) && !isPopulated(user)) return user;

  return omitInsecureAttributes(user);
}
