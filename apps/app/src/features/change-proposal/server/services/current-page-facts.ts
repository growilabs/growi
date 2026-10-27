import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import { isTrashPage } from '@growi/core/dist/utils/page-path-utils';
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
  canTrashPage,
  type PageDeletePermissionService,
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
  readonly pageService: PageDeletePermissionService;
};

// Trashed pages are included because a revert proposal's trash is itself revertible;
// "anyone with the link" pages are kept apart so non-requesters can be denied them.
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
    anyoneWithLinkPageIds: new Set(
      found
        .filter((page) => page.grant === Page.GRANT_RESTRICTED)
        .map((page) => page._id.toString()),
    ),
  };
};

// The only paths judgeRevertability asks about: where a move came from, and where
// a trashed page returns to (the same name revertDeletedPage computes).
const pathsToCheck = (
  operations: readonly OperationRecord[],
  pages: ViewablePages['pages'],
): string[] =>
  operations.flatMap((op) => {
    if (op.type === 'move') {
      return [op.fromPath];
    }
    const pageId = targetPageIdOf(op);
    const page = pageId == null ? undefined : pages.get(pageId);
    return op.type === 'trash' && page != null && isTrashPage(page.path)
      ? [pageModel().getRevertDeletedPageName(page.path) as string]
      : [];
  });

// No query for a non-empty page; an empty one reads its closest non-empty ancestor.
const loadDeletablePageIds = async (
  operations: readonly OperationRecord[],
  pages: ViewablePages['pages'],
  { user, pageService }: DeleteAuthority,
): Promise<ReadonlySet<string>> => {
  const targetIds = new Set(operations.map(targetPageIdOf));
  const targets = [...pages.entries()].filter(([id]) => targetIds.has(id));
  const deletable = await Promise.all(
    targets.map(async ([id, page]) =>
      (await canTrashPage(pageService, page, user)) ? [id] : [],
    ),
  );
  return new Set(deletable.flat());
};

/**
 * Reads, in two queries for any number of operations (plus one per empty
 * target page for the delete authority), the page state judgeRevertability
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
  const paths = [...new Set(pathsToCheck(operations, pages))];

  const [parentIds, occupiedPaths, deletablePageIds] = await Promise.all([
    // An empty child counts, as in the trash handler: deletePage would leave an empty page behind.
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
