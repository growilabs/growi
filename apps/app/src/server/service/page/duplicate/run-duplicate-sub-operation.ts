import { escapeStringForMongoRegex, pathUtils } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { collectAncestorPaths } from '~/server/util/collect-ancestor-paths';

import type { DuplicateDeps } from './duplicate-page-port';

const { addTrailingSlash } = pathUtils;

export type AncestorUpdate =
  | { readonly kind: 'increment'; readonly insertedPageCount: number }
  | { readonly kind: 'recount' };

export interface SubOperationInput {
  readonly toPath: string;
  /** normalizeParentRecursively in duplicate mode skips only the grant filter; it still reads user._id, so the caller passes { _id: ObjectId(userId) }, not the bare string. */
  readonly userId: string;
  readonly shouldNormalizeParent: boolean;
  readonly ancestorUpdate: AncestorUpdate;
  /** Called before each batch; throwing (e.g. OwnershipLostError) aborts the sub operation. */
  readonly onBatchStart: () => Promise<void>;
}

export const runDuplicateSubOperation = async (
  deps: Pick<DuplicateDeps, 'pageService' | 'pageEvent'>,
  input: SubOperationInput,
): Promise<{ readonly copiedPageCount: number }> => {
  const { pageService, pageEvent } = deps;
  const { toPath, shouldNormalizeParent, ancestorUpdate, onBatchStart } = input;
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const user = { _id: new mongoose.Types.ObjectId(input.userId) };

  if (shouldNormalizeParent) {
    await pageService.normalizeParentRecursively(
      [toPath],
      user,
      true,
      false,
      onBatchStart,
    );
  }

  await pageService.updateDescendantCountOfSelfAndDescendants(
    toPath,
    onBatchStart,
  );

  const copyTopPage = await Page.findOne({ path: toPath });
  if (copyTopPage == null) {
    throw new Error(`No duplicated page found at "${toPath}"`);
  }

  if (ancestorUpdate.kind === 'increment') {
    await onBatchStart();
    await pageService.updateDescendantCountOfAncestors(
      copyTopPage._id,
      ancestorUpdate.insertedPageCount,
      false,
    );
  } else {
    await pageService.updateDescendantCountOfPagesWithPaths(
      collectAncestorPaths(toPath),
      onBatchStart,
    );
  }

  pageEvent.emit('syncDescendantsUpdate', copyTopPage, user);

  const copiedPageCount = await Page.countDocuments({
    isEmpty: { $ne: true },
    $or: [
      { path: toPath },
      {
        path: new RegExp(
          `^${escapeStringForMongoRegex(addTrailingSlash(toPath))}`,
        ),
      },
    ],
  });
  return { copiedPageCount };
};
