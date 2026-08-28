import { Document } from 'mongoose';

import { isPopulated, isRef, type Ref } from '../../interfaces/common.js';
import type { IUser } from '../../interfaces/user.js';

/**
 * The single source of truth for the user fields that must never be serialized
 * to a client: the two credential hashes, the API token, and the email (which is
 * conditionally re-exposed below only when the user published it).
 *
 * Every serializer that strips insecure user fields MUST derive its omission set
 * from this list rather than hard-coding its own copy — the Prisma `users`
 * extension (`serializeSecurely`, apps/app) drove a `passwordHash` leak precisely
 * because it kept a separate, out-of-date destructure. `isInsecureUserAttribute`
 * below is the shared runtime membership check consumers use.
 */
export const INSECURE_USER_ATTRIBUTES = [
  'password',
  'passwordHash',
  'apiToken',
  'email',
] as const;

export type InsecureUserAttribute = (typeof INSECURE_USER_ATTRIBUTES)[number];

const insecureUserAttributeSet: ReadonlySet<string> = new Set(
  INSECURE_USER_ATTRIBUTES,
);

/** True when `key` is a user field that must be stripped before serialization. */
export const isInsecureUserAttribute = (key: string): boolean =>
  insecureUserAttributeSet.has(key);

export type IUserSerializedSecurely<U extends IUser> = Omit<
  U,
  InsecureUserAttribute
> & { email?: string };

export const omitInsecureAttributes = <U extends IUser>(
  user: U,
): IUserSerializedSecurely<U> => {
  const leanDoc = user instanceof Document ? user.toObject<U>() : user;

  // Drive the omission from the shared INSECURE_USER_ATTRIBUTES list (not a local
  // destructure) so a newly added credential field is stripped everywhere at once.
  const secureUser = Object.fromEntries(
    Object.entries(leanDoc).filter(([key]) => !isInsecureUserAttribute(key)),
  ) as IUserSerializedSecurely<U>;

  // email was removed above; re-expose it only when the user published it.
  if (leanDoc.isEmailPublished) {
    secureUser.email = leanDoc.email;
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
