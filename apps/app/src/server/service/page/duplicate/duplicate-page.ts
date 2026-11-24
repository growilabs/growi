import type {
  IGrantedGroup,
  IPage,
  IRevisionHasId,
  IUserHasId,
} from '@growi/core';
import { getIdForRef } from '@growi/core';
import { PageGrant } from '@growi/core/dist/interfaces';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { IOptionsForCreate } from '~/interfaces/page';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument, PageModel } from '~/server/models/page';
import { serializePageSecurely } from '~/server/models/serializers/page-serializer';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  PageOperationRefusalReason,
  PageOperationRefusedError,
} from '../page-operation-refusal';
import { shouldUseV4Process } from '../should-use-v4-process';
import { createDuplicatePageOperation } from './duplicate-page-operation';
import type { DuplicateDeps } from './duplicate-page-port';
import { runDescendantDuplication } from './run-descendant-duplication';
import { runDescendantDuplicationV4 } from './run-descendant-duplication-v4';

const logger = loggerFactory('growi:services:page:duplicate:duplicate-page');

export interface DuplicateRequest {
  readonly page: HydratedDocument<PageDocument>;
  readonly newPagePath: string;
  readonly user: IUserHasId;
  readonly isRecursively: boolean;
  readonly onlyDuplicateUserRelatedResources: boolean;
}

export type DuplicatedPage = ReturnType<typeof serializePageSecurely> & {
  tags: string[];
};

interface GrantToCopy {
  readonly grant: PageGrant;
  readonly grantedUserIds: ObjectIdLike[];
  readonly grantedGroupIds: IGrantedGroup[];
}

const getPageModel = () => mongoose.model<IPage, PageModel>('Page');

/** The grant the copy takes: an empty page takes its parent's. */
async function resolveGrantToCopy(
  deps: DuplicateDeps,
  { page, user, onlyDuplicateUserRelatedResources }: DuplicateRequest,
): Promise<GrantToCopy> {
  let grantSource: PageDocument = page;
  if (page.isEmpty) {
    const parent = await getPageModel().findOne({ _id: page.parent });
    if (parent == null) {
      throw Error('parent not found');
    }
    grantSource = parent;
  }
  return {
    grant: grantSource.grant,
    grantedUserIds: grantSource.grantedUsers.map((u) => getIdForRef(u)),
    grantedGroupIds: onlyDuplicateUserRelatedResources
      ? await deps.pageGrantService.getUserRelatedGrantedGroups(
          grantSource,
          user,
        )
      : grantSource.grantedGroups,
  };
}

async function assertGrantAssignable(
  deps: DuplicateDeps,
  user: IUserHasId,
  newPagePathSanitized: string,
  { grant, grantedUserIds, grantedGroupIds }: GrantToCopy,
): Promise<void> {
  if (grant === PageGrant.GRANT_RESTRICTED) {
    return;
  }
  let isGrantNormalized = false;
  try {
    isGrantNormalized = await deps.pageGrantService.isGrantNormalized(
      user,
      newPagePathSanitized,
      grant,
      grantedUserIds,
      grantedGroupIds,
      false,
    );
  } catch (err) {
    logger.error(
      `Failed to validate grant of page at "${newPagePathSanitized}" when duplicating`,
      err,
    );
    throw err;
  }
  if (!isGrantNormalized) {
    throw new PageOperationRefusedError(
      PageOperationRefusalReason.GRANT_NOT_ASSIGNABLE,
      `This page cannot be duplicated to "${newPagePathSanitized}" since the selected grant or grantedGroup is not assignable to this page.`,
    );
  }
}

async function createTopCopy(
  deps: DuplicateDeps,
  { page, user }: DuplicateRequest,
  newPagePath: string,
  { grant, grantedGroupIds }: GrantToCopy,
): Promise<HydratedDocument<PageDocument>> {
  if (page.isEmpty) {
    const parent = await deps.pageService.getParentAndFillAncestorsByUser(
      user,
      newPagePath,
    );
    return getPageModel().createEmptyPage(newPagePath, parent);
  }
  const populatedPage = await page.populate<{
    revision: IRevisionHasId | null;
  }>({ path: 'revision', model: 'Revision', select: 'body' });
  const options: IOptionsForCreate = {
    grant,
    grantUserGroupIds: grantedGroupIds,
  };
  return deps.pageService.create(
    newPagePath,
    populatedPage?.revision?.body ?? '',
    user,
    options,
  );
}

/** Gives the copy the source's tags and returns the copy's tag names. */
async function takeOverTags(
  deps: DuplicateDeps,
  copy: HydratedDocument<PageDocument>,
  originTags: string[],
): Promise<string[]> {
  await prisma.pagetagrelations.updatePageTags(copy._id, originTags);
  const savedTags = await prisma.pagetagrelations.listTagNamesByPage(copy._id);
  deps.tagEvent.emit('update', copy, savedTags);
  return savedTags;
}

async function startDescendantDuplication(
  deps: DuplicateDeps,
  { page, user, onlyDuplicateUserRelatedResources }: DuplicateRequest,
  newPagePath: string,
): Promise<void> {
  let operation: Awaited<ReturnType<typeof createDuplicatePageOperation>>;
  try {
    operation = await createDuplicatePageOperation({
      page,
      userId: user._id.toString(),
      fromPath: page.path,
      toPath: newPagePath,
    });
  } catch (err) {
    logger.error('Failed to create PageOperation document.', err);
    throw err;
  }

  // Not awaited: the response returns before the descendants are copied (Req 6.1).
  void runDescendantDuplication(deps, {
    operation,
    sourcePage: page,
    newPagePath,
    user,
    onlyDuplicateUserRelatedResources,
  });
}

/** A v4 page skips the operation check and the grant check. */
async function duplicatePageV4(
  deps: DuplicateDeps,
  { page, user, isRecursively }: DuplicateRequest,
  newPagePathSanitized: string,
): Promise<DuplicatedPage> {
  // WHY non-null: a v4 page always has a revision; a missing one throws a TypeError here.
  const populatedPage = await page.populate<{ revision: IRevisionHasId }>({
    path: 'revision',
    model: 'Revision',
    select: 'body',
  });
  const createdPage = await deps.pageService.create(
    newPagePathSanitized,
    populatedPage.revision.body,
    user,
    { grant: page.grant, grantUserGroupIds: page.grantedGroups },
  );
  deps.pageEvent.emit('duplicate', page, user);

  if (isRecursively) {
    // Not awaited: the response returns before the descendants are copied (Req 6.1).
    void runDescendantDuplicationV4(deps, {
      sourcePath: page.path,
      newPagePath: newPagePathSanitized,
      user,
    });
  }

  const originTags = await page.findRelatedTagsById();
  const savedTags = await takeOverTags(deps, createdPage, originTags);
  return { ...serializePageSecurely(createdPage), tags: savedTags };
}

/**
 * Duplicates a page, and starts duplicating its descendants without awaiting
 * them (see design.md duplicatePage).
 */
export async function duplicatePage(
  deps: DuplicateDeps,
  request: DuplicateRequest,
): Promise<DuplicatedPage> {
  const { page, newPagePath, user, isRecursively } = request;
  if (page.isEmpty && !isRecursively) {
    throw new Error('Cannot find or duplicate the empty page');
  }

  const newPagePathSanitized = generalXssFilter.process(newPagePath);

  if (shouldUseV4Process(page)) {
    return duplicatePageV4(deps, request, newPagePathSanitized);
  }

  const canOperate = await deps.pageOperationService.canOperate(
    isRecursively,
    page.path,
    newPagePathSanitized,
  );
  if (!canOperate) {
    throw new PageOperationRefusedError(
      PageOperationRefusalReason.OPERATION_IN_PROGRESS,
      `Cannot operate duplicate to path "${newPagePathSanitized}" right now.`,
    );
  }

  const grantToCopy = await resolveGrantToCopy(deps, request);
  await assertGrantAssignable(deps, user, newPagePathSanitized, grantToCopy);

  const copy = await createTopCopy(
    deps,
    request,
    newPagePathSanitized,
    grantToCopy,
  );
  deps.pageEvent.emit('duplicate', page, user);

  const originTags = await page.findRelatedTagsById();
  const savedTags =
    originTags.length !== 0 ? await takeOverTags(deps, copy, originTags) : [];

  if (isRecursively) {
    await startDescendantDuplication(deps, request, newPagePathSanitized);
  }

  return { ...serializePageSecurely(copy), tags: savedTags };
}
