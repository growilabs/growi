import { Document } from 'mongoose';

import { isPopulated, isRef, type Ref } from '../../interfaces/common.js';

/** The only attributes the serializer reads. */
export type SerializableUser = {
  password?: string | null;
  apiToken?: string | null;
  email?: string | null;
  isEmailPublished: boolean;
};

export type IUserSerializedSecurely<U extends SerializableUser> = Omit<
  U,
  'password' | 'apiToken' | 'email'
> & { email?: NonNullable<U['email']> };

export const omitInsecureAttributes = <U extends SerializableUser>(
  user: U,
): IUserSerializedSecurely<U> => {
  const leanDoc = user instanceof Document ? user.toObject<U>() : user;

  const { password, apiToken, email, ...rest } = leanDoc;

  const secureUser: IUserSerializedSecurely<U> = rest;

  // omit email
  if (leanDoc.isEmailPublished && email != null) {
    secureUser.email = email;
  }

  return secureUser;
};

export function serializeUserSecurely<U extends SerializableUser>(
  user?: U,
): IUserSerializedSecurely<U>;
export function serializeUserSecurely<U extends SerializableUser>(
  user?: Ref<U>,
): Ref<IUserSerializedSecurely<U>>;
export function serializeUserSecurely<U extends SerializableUser>(
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
