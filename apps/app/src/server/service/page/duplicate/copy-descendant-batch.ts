import { getIdStringForRef, type IPage, type IUserHasId } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  copyCurrentRevisions,
  type RevisionCopyEntry,
} from './copy-current-revisions';
import type { DuplicateDeps } from './duplicate-page-port';

const logger = loggerFactory(
  'growi:services:page:duplicate:copy-descendant-batch',
);

export interface DescendantBatchInput {
  readonly pages: readonly PageDocument[]; // lean documents from the cursor
  readonly oldPathPrefix: RegExp; // in-process only; never sent to MongoDB
  readonly newPathPrefix: string;
  readonly user: IUserHasId;
  readonly onlyDuplicateUserRelatedResources: boolean;
  /** Called right before each write; throws OwnershipLostError to stop. */
  readonly recordProgress: () => Promise<void>;
}

type CopiedPage = Pick<
  IPage,
  | 'path'
  | 'creator'
  | 'lastUpdateUser'
  | 'grant'
  | 'grantedGroups'
  | 'grantedUsers'
  | 'revision'
> & { readonly _id: string };

interface PlannedCopy {
  readonly sourcePageId: string;
  readonly revisionEntry: RevisionCopyEntry;
  readonly newPage: CopiedPage;
}

const newObjectIdString = (): string => new Types.ObjectId().toHexString();

/** Non-empty pages, narrowed to those the user can view when requested. */
const selectTargetPages = async (
  pageGrantService: DuplicateDeps['pageGrantService'],
  input: DescendantBatchInput,
): Promise<{
  readonly targets: readonly PageDocument[];
  readonly grantedGroupsOf: (page: PageDocument) => IPage['grantedGroups'];
}> => {
  const { pages, user, onlyDuplicateUserRelatedResources } = input;
  const nonEmptyPages = pages.filter((page) => !page.isEmpty);
  if (!onlyDuplicateUserRelatedResources) {
    return {
      targets: nonEmptyPages,
      grantedGroupsOf: (page) => page.grantedGroups,
    };
  }

  const userRelatedGroups = await pageGrantService.getUserRelatedGroups(user);
  return {
    targets: nonEmptyPages.filter((page) =>
      pageGrantService.isUserGrantedPageAccess(page, user, userRelatedGroups),
    ),
    grantedGroupsOf: (page) =>
      pageGrantService.getUserRelatedGrantedGroupsSyncronously(
        userRelatedGroups,
        page,
      ),
  };
};

const planCopies = (
  targets: readonly PageDocument[],
  grantedGroupsOf: (page: PageDocument) => IPage['grantedGroups'],
  input: DescendantBatchInput,
): PlannedCopy[] =>
  targets.flatMap((page) => {
    // A page without a current revision cannot be copied; it is counted as skipped.
    if (page._id == null || page.revision == null) return [];
    const newPageId = newObjectIdString();
    const newRevisionId = newObjectIdString();
    return [
      {
        sourcePageId: page._id.toHexString(),
        revisionEntry: {
          sourceRevisionId: getIdStringForRef(page.revision),
          newRevisionId,
          newPageId,
        },
        // No parent here: the sub operation attaches copies to the page tree.
        newPage: {
          _id: newPageId,
          path: page.path.replace(input.oldPathPrefix, input.newPathPrefix),
          creator: input.user._id,
          lastUpdateUser: input.user._id,
          grant: page.grant,
          grantedGroups: grantedGroupsOf(page),
          grantedUsers: page.grantedUsers,
          revision: newRevisionId,
        },
      },
    ];
  });

const copyTags = async (copies: readonly PlannedCopy[]): Promise<void> => {
  const newPageIdBySource = new Map(
    copies.map((c) => [c.sourcePageId, c.revisionEntry.newPageId]),
  );
  const relations = await prisma.pagetagrelations.findMany({
    where: { relatedPageId: { in: [...newPageIdBySource.keys()] } },
    select: { relatedPageId: true, relatedTagId: true },
  });

  const data = relations.flatMap(({ relatedPageId, relatedTagId }) => {
    const newPageId = newPageIdBySource.get(relatedPageId);
    return newPageId == null
      ? []
      : [{ relatedPageId: newPageId, relatedTagId }];
  });
  if (data.length > 0) {
    await prisma.pagetagrelations.createMany({ data });
  }
};

/** Returns only the copies actually stored: with ordered: false, Mongoose drops documents failing validation without throwing. */
const insertPages = async (
  copies: readonly PlannedCopy[],
  recordProgress: () => Promise<void>,
): Promise<PlannedCopy[]> => {
  if (copies.length === 0) return [];

  const Page = mongoose.model<PageDocument, PageModel>('Page');
  await recordProgress();
  const inserted = await Page.insertMany(
    copies.map((c) => c.newPage),
    { ordered: false },
  );
  const insertedIds = new Set(inserted.map((p) => p._id.toHexString()));
  return copies.filter((c) => insertedIds.has(c.newPage._id));
};

/**
 * Copies one batch of descendant pages in the order revision → page → tag,
 * recording progress right before each write (design.md 書き込みの規則).
 */
export async function copyDescendantBatch(
  deps: Pick<DuplicateDeps, 'pageGrantService'>,
  input: DescendantBatchInput,
): Promise<{ readonly insertedPageCount: number }> {
  const { targets, grantedGroupsOf } = await selectTargetPages(
    deps.pageGrantService,
    input,
  );
  const planned = planCopies(targets, grantedGroupsOf, input);

  const { copiedRevisionIds } =
    planned.length === 0
      ? { copiedRevisionIds: new Set<string>() }
      : await copyCurrentRevisions(
          planned.map((c) => c.revisionEntry),
          input.user._id.toString(),
          input.recordProgress,
        );
  const copies = planned.filter((c) =>
    copiedRevisionIds.has(c.revisionEntry.newRevisionId),
  );
  const insertedCopies = await insertPages(copies, input.recordProgress);

  const skippedCount = targets.length - insertedCopies.length;
  if (skippedCount > 0) {
    logger.warn(
      `Skipped ${skippedCount} page(s) whose revision or page could not be copied`,
    );
  }
  if (insertedCopies.length === 0) {
    return { insertedPageCount: 0 };
  }

  await input.recordProgress();
  await copyTags(insertedCopies);

  return { insertedPageCount: insertedCopies.length };
}
