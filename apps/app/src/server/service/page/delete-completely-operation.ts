import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageModel } from '~/server/models/page';
import PageTagRelation from '~/server/models/page-tag-relation';
import { prisma } from '~/utils/prisma';

import { Attachment } from '../../models/attachment';
import PageRedirect from '../../models/page-redirect';
import { Revision } from '../../models/revision';
import ShareLink from '../../models/share-link';
import {
  type ActivityActor,
  recordCascadeAttachmentRemovals,
} from '../attachment/attachment-removal-snapshot';
import {
  buildPageIdToPathMap,
  toAttachmentLikes,
} from './cascade-attachment-removal-inputs';

/**
 * Deletes every artifact of the given pages — attachments, comments, tag
 * relations, share links, revisions, redirects and the page documents
 * themselves. This is the shared "complete deletion" primitive that all
 * complete-delete / empty-trash / group-delete paths converge on.
 *
 * Extracted from PageService (index.ts) to keep that file focused; the class
 * method now delegates here. Following the executor principle, the work-set
 * (pageIds / pagePaths / actor) is passed in and collaborators are injected via
 * `crowi` — the function owns neither. Emitting the follow-up page events stays
 * the caller's responsibility, exactly as before the extraction.
 *
 * When `actor` is non-null, one ACTION_ATTACHMENT_REMOVE activity is recorded
 * per cascaded attachment BEFORE storage deletion (requirement 3.4); the
 * recorder isolates per-record failures internally and never rejects, so page
 * deletion is not blocked. A null actor marks a system operation with no
 * operator (deleteCompletelyUserHomeBySystem) and records nothing.
 */
export const deleteCompletelyOperation = async (
  crowi: Crowi,
  pageIds: ObjectIdLike[],
  pagePaths: string[],
  actor: ActivityActor | null,
): Promise<void> => {
  // Delete Attachments, Revisions, Pages and emit delete
  const Page = mongoose.model<IPage, PageModel>('Page');

  const { attachmentService } = crowi;
  const attachments = await Attachment.find({ page: { $in: pageIds } });

  if (actor != null) {
    await recordCascadeAttachmentRemovals(
      crowi.activityService,
      toAttachmentLikes(attachments),
      buildPageIdToPathMap(pageIds, pagePaths),
      actor,
    );
  }

  // prisma's `comments.pageId` (String @db.ObjectId) filter expects hex strings,
  // whereas the mongoose `$in` queries below accept ObjectIdLike as-is. Normalize
  // to strings for the prisma side only (same ObjectId-stringify convention as
  // cascade-attachment-removal-inputs); no-op for ids already in string form.
  const pageIdStrings = pageIds.map((pageId) => pageId.toString());

  await Promise.all([
    prisma.$transaction([
      prisma.comments.deleteMany({
        where: {
          pageId: {
            in: pageIdStrings,
          },
          replyToId: {
            not: null,
          },
        },
      }),
      prisma.comments.deleteMany({
        where: {
          pageId: {
            in: pageIdStrings,
          },
        },
      }),
    ]),
    PageTagRelation.deleteMany({ relatedPage: { $in: pageIds } }),
    ShareLink.deleteMany({ relatedPage: { $in: pageIds } }),
    Revision.deleteMany({ pageId: { $in: pageIds } }),
    Page.deleteMany({ _id: { $in: pageIds } }),
    PageRedirect.deleteMany({
      $or: [{ fromPath: { $in: pagePaths } }, { toPath: { $in: pagePaths } }],
    }),
    attachmentService.removeAllAttachments(attachments),

    // Leave bookmarks without deleting -- 2024.05.17 Yuki Takei
  ]);
};
