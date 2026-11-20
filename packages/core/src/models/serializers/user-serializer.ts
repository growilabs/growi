import { Document } from 'mongoose';

import { isPopulated, isRef, type Ref } from '../../interfaces/common.js';
import type { IUser } from '../../interfaces/user.js';

export type IUserSerializedSecurely<U extends IUser> = Omit<
  U,
  'password' | 'apiToken' | 'email'
> & { email?: string };

export const omitInsecureAttributes = <U extends IUser>(
  user: U,
): IUserSerializedSecurely<U> => {
  const leanDoc = user instanceof Document ? user.toObject<U>() : user;

  const { password, apiToken, email, ...rest } = leanDoc;

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

type PrismaUserLike = { imageAttachmentId?: string | null };

export type IUserLegacyShape<U extends PrismaUserLike> = U & {
  imageAttachment: U['imageAttachmentId'];
};

/**
 * Restore the Mongoose-era field name (`imageAttachment`) on a Prisma user row.
 *
 * TODO: only `imageAttachment` is restored so far. Map the remaining Prisma/Mongoose as the callers that need them are migrated.
 */
export const toLegacyUserShape = <U extends PrismaUserLike>(
  user: U,
): IUserLegacyShape<U> => ({
  ...user,
  imageAttachment: user.imageAttachmentId,
});
