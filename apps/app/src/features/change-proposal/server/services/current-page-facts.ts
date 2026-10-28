import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import type { PageDocument } from '~/server/models/page';

import type { OperationRecord } from '../../interfaces';
import {
  type CurrentPageFacts,
  targetPageIdOf,
  type VisibilityContext,
} from '../domain';
import { pageModel } from './operation-handlers/page-model';
import {
  createCanDeletePageCompletely,
  type PageDeletePermissionServices,
} from './page-delete-permission';

export type ViewablePages = Omit<VisibilityContext, 'isRequester'> & {
  readonly pages: ReadonlyMap<string, HydratedDocument<PageDocument>>;
};

const MISSING_PAGE: CurrentPageFacts = {
  exists: false,
  path: null,
  latestRevisionId: null,
  hasChildren: false,
  canDelete: false,
  isPathOccupied: () => false,
};

// Whose delete authority judgeRevertability weighs: the user asking to revert,
// or the viewer the revertability is shown to.
export type DeleteAuthority = {
  readonly user: IUserHasId;
  readonly services: PageDeletePermissionServices;
};

// Trashed pages are included because an operation on a page a human trashed still
// shows; "anyone with the link" pages are kept apart so non-requesters can be
// denied them, and pages that no longer exist so only the requester sees them.
// Asked only about the pages the viewer could not read, which are usually none.
const findDeletedPageIds = async (
  pageIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  const unique = [...new Set(pageIds)];
  if (unique.length === 0) {
    return new Set();
  }
  const existing = await pageModel().distinct('_id', { _id: { $in: unique } });
  const existingIds = new Set((existing as unknown[]).map(String));
  return new Set(unique.filter((id) => !existingIds.has(id)));
};

export const loadViewablePages = async (
  pageIds: readonly string[],
  viewer: IUserHasId,
): Promise<ViewablePages> => {
  const Page = pageModel();
  const found =
    pageIds.length === 0
      ? []
      : await Page.findByIdsAndViewer(
          [...new Set(pageIds)],
          viewer,
          null,
          false,
          true,
        );
  const pages = new Map(found.map((page) => [page._id.toString(), page]));
  return {
    pages,
    viewablePageIds: new Set(pages.keys()),
    deletedPageIds: await findDeletedPageIds(
      pageIds.filter((id) => !pages.has(id)),
    ),
    anyoneWithLinkPageIds: new Set(
      found
        .filter((page) => page.grant === Page.GRANT_RESTRICTED)
        .map((page) => page._id.toString()),
    ),
  };
};

// The only paths judgeRevertability asks about: where a move came from.
const pathsToCheck = (operations: readonly OperationRecord[]): string[] =>
  operations.flatMap((op) => (op.type === 'move' ? [op.fromPath] : []));

// Only a create's revert deletes a page, so only created pages are judged.
const loadDeletablePageIds = async (
  operations: readonly OperationRecord[],
  pages: ViewablePages['pages'],
  { user, services }: DeleteAuthority,
): Promise<ReadonlySet<string>> => {
  const targetIds = new Set(
    operations.flatMap((op) =>
      op.type === 'create' && op.resultPageId != null ? [op.resultPageId] : [],
    ),
  );
  const targets = [...pages.entries()].filter(([id]) => targetIds.has(id));
  if (targets.length === 0) {
    return new Set();
  }
  const canDeletePageCompletely = await createCanDeletePageCompletely(
    services,
    user,
  );
  const deletable = await Promise.all(
    targets.map(async ([id, page]) =>
      (await canDeletePageCompletely(page)) ? [id] : [],
    ),
  );
  return new Set(deletable.flat());
};

/**
 * Reads, in two queries for any number of operations (plus, when a create is
 * among them, one for the user's groups and one per empty created page for the
 * delete authority), the page state judgeRevertability
 * needs. `pages` are the operations' target pages as already
 * loaded (loadViewablePages); an operation whose page is not there reads as missing.
 */
export const loadCurrentPageFacts = async (
  operations: readonly OperationRecord[],
  pages: ViewablePages['pages'],
  deleteAuthority: DeleteAuthority,
): Promise<(op: OperationRecord) => CurrentPageFacts> => {
  const Page = pageModel();
  const pageObjectIds = [...pages.values()].map((page) => page._id);
  const paths = [...new Set(pathsToCheck(operations))];

  const [parentIds, occupiedPaths, deletablePageIds] = await Promise.all([
    // An empty child counts, as in the delete-completely handler: deleteCompletely would leave an empty page behind.
    pageObjectIds.length === 0
      ? []
      : Page.distinct('parent', { parent: { $in: pageObjectIds } }),
    // An empty placeholder page does not occupy its path (revertDeletedPage and rename replace it).
    paths.length === 0
      ? []
      : Page.distinct('path', { path: { $in: paths }, isEmpty: false }),
    loadDeletablePageIds(operations, pages, deleteAuthority),
  ]);
  const withChildren = new Set(
    (parentIds as unknown[]).map((id) => String(id)),
  );
  const checkedPaths = new Set(paths);
  const occupied = new Set(occupiedPaths as string[]);
  const isPathOccupied = (path: string): boolean => {
    if (!checkedPaths.has(path)) {
      throw new Error(`Path occupancy was not loaded for ${path}`);
    }
    return occupied.has(path);
  };

  return (op) => {
    const pageId = targetPageIdOf(op);
    const page = pageId == null ? undefined : pages.get(pageId);
    if (page == null) {
      return MISSING_PAGE;
    }
    return {
      exists: true,
      path: page.path,
      latestRevisionId:
        page.revision == null ? null : getIdStringForRef(page.revision),
      hasChildren: withChildren.has(page._id.toString()),
      canDelete: deletablePageIds.has(page._id.toString()),
      isPathOccupied,
    };
  };
};
