/**
 * NEW: The document is newly created and not yet synced with the latest revision.
 * SYNCED: The document is synced with the latest revision.
 * DRAFT: The document advances as a draft compared to the latest revision
 * OUTDATED: The document is outdated and needs to be synced with the latest revision.
 * ISOLATED: The latest revision does not exist and the document is isolated from the page.
 */
export const YDocStatus = {
  NEW: 'new',
  SYNCED: 'synced',
  DRAFT: 'draft',
  OUTDATED: 'outdated',
  ISOLATED: 'isolated',
} as const;
export type YDocStatus = (typeof YDocStatus)[keyof typeof YDocStatus];
