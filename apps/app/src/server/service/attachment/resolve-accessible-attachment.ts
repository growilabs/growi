import type { IPage, IUser } from '@growi/core';
import { objectIdUtils } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import type { attachments, Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

// TODO: remove this local interface when models/page has typescriptized
export interface PageModel {
  isAccessiblePageByViewer: (
    pageId: string,
    user: IUser | undefined,
  ) => Promise<boolean>;
}

/**
 * Derived via an instantiation expression (`typeof prisma.attachments
 * .findUnique<...>`) against the real extended client method, rather than
 * hand-reconstructed from `Prisma.attachmentsGetPayload`: the latter is
 * bound to the pre-extension `$attachmentsPayload` and does not know about
 * the `result.attachments` extension's computed fields (`_id`, `__v`,
 * `filePathProxied`, ...) added in `models/attachment.ts`.
 */
export type AttachmentWithInclude<
  T extends Prisma.attachmentsInclude | undefined,
> = NonNullable<
  Awaited<
    ReturnType<
      typeof prisma.attachments.findUnique<{
        where: { id: string };
        include: T;
      }>
    >
  >
>;

export type ResolveAccessibleAttachmentResult<
  T extends Prisma.attachmentsInclude | undefined = undefined,
> =
  | { attachment: AttachmentWithInclude<T> }
  | { errorCode: 'not_found' | 'forbidden' };

/**
 * Checks whether the viewer may access an already-fetched attachment.
 *
 * Skips the check when the request is already certified via a valid share
 * link (isSharedPage), or when the attachment is not scoped to a page
 * (PROFILE_IMAGE, BRAND_LOGO, PAGE_BULK_EXPORT, AUDIT_LOG_BULK_EXPORT).
 *
 * Split out from resolveAccessibleAttachment so callers that fetch the
 * attachment themselves (e.g. a batched `Attachment.find({ $in })`) can reuse
 * the same permission check without a second per-id `findById`.
 */
export const isAttachmentAccessibleToViewer = async (
  attachment: attachments,
  user: IUser | undefined,
  isSharedPage: boolean,
): Promise<boolean> => {
  if (isSharedPage || attachment.pageId == null) {
    return true;
  }

  const Page = mongoose.model<IPage, PageModel>('Page');
  return Page.isAccessiblePageByViewer(attachment.pageId, user);
};

/**
 * Fetches an attachment by id and checks whether the viewer may access it.
 */
export const resolveAccessibleAttachment = async <
  T extends Prisma.attachmentsInclude | undefined = undefined,
>(
  attachmentId: string,
  user: IUser | undefined,
  isSharedPage: boolean,
  include?: T,
): Promise<ResolveAccessibleAttachmentResult<T>> => {
  // Prisma throws on a non-24-hex ObjectId instead of returning null
  if (!objectIdUtils.isValidObjectId(attachmentId)) {
    return { errorCode: 'not_found' };
  }

  // This call's own inferred return type and `AttachmentWithInclude<T>` are
  // two separate instantiations of the same distributive conditional type
  // (Prisma's payload type) and are not structurally unified by the compiler
  // while `T` stays abstract inside this generic function body. The cast
  // bridges that TS limitation; the runtime value is unaffected — it is the
  // same object either way.
  const attachment = (await prisma.attachments.findUnique({
    where: { id: attachmentId },
    include,
  })) as AttachmentWithInclude<T> | null;

  if (attachment == null) {
    return { errorCode: 'not_found' };
  }

  const isAccessible = await isAttachmentAccessibleToViewer(
    attachment,
    user,
    isSharedPage,
  );
  if (!isAccessible) {
    return { errorCode: 'forbidden' };
  }

  return { attachment };
};
