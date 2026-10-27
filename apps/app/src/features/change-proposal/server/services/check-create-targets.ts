import type { IUser, IUserHasId, Ref } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { CreatableOperationInput } from '../../interfaces';
import type { AutoApplyPageFacts } from '../domain';
import type { ServiceError } from './change-proposal-service-types';

type PageTargetOperation = Extract<
  CreatableOperationInput,
  { type: 'edit' | 'move' }
>;

type TargetCheck =
  | {
      readonly ok: true;
      readonly pageFacts: ReadonlyMap<string, AutoApplyPageFacts>;
    }
  | { readonly ok: false; readonly error: ServiceError };

const hasTargetPage = (
  op: CreatableOperationInput,
): op is PageTargetOperation => op.type === 'edit' || op.type === 'move';

const idOrNull = (ref: Ref<IUser> | null | undefined): string | null =>
  ref == null ? null : getIdStringForRef(ref);

const toPageFacts = (
  page: HydratedDocument<PageDocument>,
): AutoApplyPageFacts => ({
  pageId: page._id.toString(),
  creatorId: idOrNull(page.creator),
  lastUpdateUserId: idOrNull(page.lastUpdateUser),
});

// Same viewer filter as a human save, so a page the requester cannot view and a
// missing one give the same answer (requirement 1.11).
const readViewablePages = async (
  pageIds: readonly string[],
  requester: IUserHasId,
): Promise<ReadonlyMap<string, HydratedDocument<PageDocument>>> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const pages = await Promise.all(
    pageIds.map((id) => Page.findByIdAndViewer(id, requester)),
  );
  return new Map(
    pages.flatMap((page) =>
      page == null ? [] : [[page._id.toString(), page]],
    ),
  );
};

const findUnavailableIndex = (
  operations: readonly CreatableOperationInput[],
  pages: ReadonlyMap<string, HydratedDocument<PageDocument>>,
): number =>
  operations.findIndex((op) => {
    if (!hasTargetPage(op)) {
      return false;
    }
    const page = pages.get(op.pageId);
    // A move is written from the path it was proposed for (the move handler's rule).
    return page == null || (op.type === 'move' && page.path !== op.fromPath);
  });

const findBaseRevisionMismatchIndex = async (
  operations: readonly CreatableOperationInput[],
): Promise<number> => {
  const revisionIds = operations.flatMap((op) =>
    op.type === 'edit' && isValidObjectId(op.baseRevisionId)
      ? [op.baseRevisionId]
      : [],
  );
  const revisions = await prisma.revisions.findMany({
    where: { id: { in: [...new Set(revisionIds)] } },
    select: { id: true, pageId: true },
  });
  const pageIdByRevision = new Map(revisions.map((r) => [r.id, r.pageId]));
  return operations.findIndex(
    (op) =>
      op.type === 'edit' &&
      pageIdByRevision.get(op.baseRevisionId) !== op.pageId,
  );
};

export const checkCreateTargets = async (
  operations: readonly CreatableOperationInput[],
  requester: IUserHasId,
): Promise<TargetCheck> => {
  const malformedIndex = operations.findIndex(
    (op) => hasTargetPage(op) && !isValidObjectId(op.pageId),
  );
  if (malformedIndex !== -1) {
    return {
      ok: false,
      error: { code: 'target-unavailable', index: malformedIndex },
    };
  }

  const pageIds = [
    ...new Set(operations.filter(hasTargetPage).map((op) => op.pageId)),
  ];
  const pages = await readViewablePages(pageIds, requester);
  const unavailableIndex = findUnavailableIndex(operations, pages);
  if (unavailableIndex !== -1) {
    return {
      ok: false,
      error: { code: 'target-unavailable', index: unavailableIndex },
    };
  }

  const mismatchIndex = await findBaseRevisionMismatchIndex(operations);
  if (mismatchIndex !== -1) {
    return {
      ok: false,
      error: { code: 'base-revision-mismatch', index: mismatchIndex },
    };
  }

  return {
    ok: true,
    pageFacts: new Map(
      [...pages.values()].map((page) => [
        page._id.toString(),
        toPageFacts(page),
      ]),
    ),
  };
};
