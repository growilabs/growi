import { getIdStringForRef, type IPage, type IUser } from '@growi/core';
import mongoose from 'mongoose';

import { Attachment, type IAttachmentDocument } from '../../models/attachment';

// TODO: remove this local interface when models/page has typescriptized
interface PageModel {
  isAccessiblePageByViewer: (
    pageId: string,
    user: IUser | undefined,
  ) => Promise<boolean>;
}

export type ResolveAccessibleAttachmentResult =
  | { attachment: IAttachmentDocument }
  | { errorCode: 'not_found' | 'forbidden' };

/**
 * Fetches an attachment by id and checks whether the viewer may access it.
 *
 * Skips the check when the request is already certified via a valid share
 * link (isSharedPage), or when the attachment is not scoped to a page
 * (PROFILE_IMAGE, BRAND_LOGO, PAGE_BULK_EXPORT, AUDIT_LOG_BULK_EXPORT).
 */
export const resolveAccessibleAttachment = async (
  attachmentId: string,
  user: IUser | undefined,
  isSharedPage: boolean,
  populate?: string,
): Promise<ResolveAccessibleAttachmentResult> => {
  const query = Attachment.findById(attachmentId);
  const attachment =
    populate != null ? await query.populate(populate) : await query;

  if (attachment == null) {
    return { errorCode: 'not_found' };
  }

  if (!isSharedPage && attachment.page != null) {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const isAccessible = await Page.isAccessiblePageByViewer(
      getIdStringForRef(attachment.page),
      user,
    );
    if (!isAccessible) {
      return { errorCode: 'forbidden' };
    }
  }

  return { attachment };
};
