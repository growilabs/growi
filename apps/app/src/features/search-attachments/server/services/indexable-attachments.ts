import type { Prisma } from '~/generated/prisma/client';

/**
 * The attachments the search index holds: only those on a page, since every
 * hit is shown only to viewers who can see its page. Profile pictures and
 * brand logos have none.
 */
export const indexableAttachments = {
  // Prisma tells an absent field apart from a null one
  pageId: { isSet: true, not: null },
} satisfies Prisma.attachmentsWhereInput;
