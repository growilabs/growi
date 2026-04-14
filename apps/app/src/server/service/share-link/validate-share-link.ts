import type { HydratedDocument } from 'mongoose';

import type {
  ShareLinkDocument,
  ShareLinkModel,
} from '~/server/models/share-link';

export type ValidateShareLinkResult =
  | { type: 'success'; shareLink: HydratedDocument<ShareLinkDocument> }
  | { type: 'not-found' }
  | { type: 'expired' };

/**
 * Validate a ShareLink by ID and related page ID.
 *
 * Performs a single database query to check for existence and page matching,
 * then evaluates expiration status.
 *
 * @param shareLinkModel - The ShareLink Mongoose model
 * @param shareLinkId - The ShareLink ID to validate
 * @param pageId - The related page ID to match
 * @returns A discriminated union indicating validation result
 */
export async function validateShareLink(
  shareLinkModel: ShareLinkModel,
  shareLinkId: string,
  pageId: string,
): Promise<ValidateShareLinkResult> {
  // Query with both _id and relatedPage for single-pass validation
  // Use $eq to force literal comparisons for untrusted inputs.
  const shareLink = await shareLinkModel.findOne({
    _id: { $eq: shareLinkId },
    relatedPage: { $eq: pageId },
  });

  // Handle not found or page mismatch
  if (shareLink == null) {
    return { type: 'not-found' };
  }

  // Check if expired
  if (shareLink.isExpired()) {
    return { type: 'expired' };
  }

  return { type: 'success', shareLink };
}
