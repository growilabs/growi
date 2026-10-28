import { Document } from 'mongoose';

import type { IAttachment, IUser } from '~/interfaces';

import { isPopulated, isRef, type Ref } from '../../interfaces/common.js';
import {
  type IUserLegacyShape,
  type IUserSerializedSecurely,
  serializeUserSecurely,
  toLegacyUserShape,
} from './user-serializer.js';

export type IAttachmentSerializedSecurely<A extends IAttachment> = Omit<
  A,
  'creator'
> & { creator?: Ref<IUserSerializedSecurely<IUser>> };

const omitInsecureAttributes = <A extends IAttachment>(
  attachment: A,
): IAttachmentSerializedSecurely<A> => {
  const leanDoc =
    attachment instanceof Document ? attachment.toObject<A>() : attachment;

  const { creator, ...rest } = leanDoc;

  const secureCreator =
    creator == null ? undefined : serializeUserSecurely(creator);

  return {
    creator: secureCreator,
    ...rest,
  };
};

export function serializeAttachmentSecurely<A extends IAttachment>(
  attachment?: A,
): IAttachmentSerializedSecurely<A>;
export function serializeAttachmentSecurely<A extends IAttachment>(
  attachment?: Ref<A>,
): Ref<IAttachmentSerializedSecurely<A>>;
export function serializeAttachmentSecurely<A extends IAttachment>(
  attachment?: A | Ref<A>,
):
  | undefined
  | IAttachmentSerializedSecurely<A>
  | Ref<IAttachmentSerializedSecurely<A>> {
  if (attachment == null) return attachment;

  if (isRef(attachment) && !isPopulated(attachment)) return attachment;

  return omitInsecureAttributes(attachment);
}

type PrismaUserLike = Parameters<typeof toLegacyUserShape>[0];

type PrismaAttachmentLike = {
  pageId?: string | null;
  creatorId?: string | null;
  creator?: PrismaUserLike | null;
};

type LegacyCreator<A extends PrismaAttachmentLike> = A extends {
  creator: infer U;
}
  ? U extends PrismaUserLike
    ? IUserLegacyShape<U>
    : U
  : A['creatorId'];

export type IAttachmentLegacyShape<A extends PrismaAttachmentLike> = A & {
  page: A['pageId'];
  creator: LegacyCreator<A>;
};

/**
 * Restore the Mongoose-era field names on a Prisma attachment row.
 * `creator` is the populated user when the query
 * included it, and the bare `creatorId` otherwise.
 */
export const toLegacyAttachmentShape = <A extends PrismaAttachmentLike>(
  attachment: A,
): IAttachmentLegacyShape<A> => {
  const { pageId, creatorId, creator } = attachment;

  // `undefined` means the relation was not included; `null` means it was and the user is gone
  const legacyCreator =
    creator === undefined ? creatorId : creator && toLegacyUserShape(creator);

  return {
    ...attachment,
    page: pageId,
    creator: legacyCreator,
  } as IAttachmentLegacyShape<A>;
};
