import { type IUser, PageStatus } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { ILinkTarget } from '../../interfaces/backlink';
import { resolveToPageIds } from './target-page-resolution';

type OutboundRow = {
  toPath: string;
  toPageId: string | null;
};

const findOutboundRows = (
  fromPageId: Types.ObjectId,
): Promise<OutboundRow[]> => {
  return prisma.pagelinks.findMany({
    where: { fromPageId: fromPageId.toString() },
    select: { toPath: true, toPageId: true },
  });
};

/**
 * The pages among `pageIds` that are in the trash and that `user` may read.
 *
 * Only the grant condition is applied — not `addConditionToExcludeTrashed`, since
 * trashed pages are exactly what this looks for. "Anyone with the link" pages count as
 * readable: the viewer holds the link — it is in the source body — and following it
 * opens the page. The status filter runs in the query,
 * so the (usually many) healthy targets are never sent back.
 */
const findReadableTrashedPages = async (
  pageIds: Types.ObjectId[],
  user: IUser | null,
  userGroups: ObjectIdLike[] | null,
): Promise<{ _id: Types.ObjectId; path: string }[]> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const builder = new PageQueryBuilder(
    Page.find({ _id: { $in: pageIds }, status: PageStatus.STATUS_DELETED }),
  );

  await builder.addViewerCondition(user, userGroups, true);

  return await builder.query.select('_id path').lean().exec();
};

/**
 * Targets that still exist but sit in the trash.
 *
 * A target missing from the grant-filtered result is omitted rather than reported
 * broken: "unreadable" and "gone" are indistinguishable there, and reporting it would
 * leak that it exists. Each page is reported once, at its current path, however many
 * rows link to it.
 */
const findTrashedTargets = async (
  rows: OutboundRow[],
  user: IUser | null,
  userGroups: ObjectIdLike[] | null,
): Promise<ILinkTarget[]> => {
  const targetIds = rows.flatMap((row) =>
    row.toPageId != null ? [new Types.ObjectId(row.toPageId)] : [],
  );
  if (targetIds.length === 0) {
    return [];
  }

  const trashedPages = await findReadableTrashedPages(
    targetIds,
    user,
    userGroups,
  );

  return trashedPages.map((page) => ({
    pageId: page._id.toString(),
    path: page.path,
    targetState: 'trashed',
  }));
};

/**
 * Paths among `toPaths` that resolve back to `fromPageId` itself.
 *
 * Asks the shared resolver rather than comparing against the source's path, because
 * `repointInboundLinks` also clears a row whose path redirects into the source.
 */
const findPathsResolvingTo = async (
  fromPageId: Types.ObjectId,
  toPaths: string[],
): Promise<Set<string>> => {
  const resolved = await resolveToPageIds(toPaths);

  return new Set(
    [...resolved]
      .filter(([, pageId]) => pageId.equals(fromPageId))
      .map(([toPath]) => toPath),
  );
};

/**
 * Rows with no target page. Their `path` is the row's own `toPath` — text the linking
 * page's author wrote, so it leaks nothing.
 *
 * Self rows are skipped: `repointInboundLinks` clears a row whose target is its own
 * source, so it reads as broken although its path resolves. It is transient —
 * `dropSelfLinks` removes it on the source's next save.
 */
const findBrokenTargets = async (
  fromPageId: Types.ObjectId,
  rows: OutboundRow[],
): Promise<ILinkTarget[]> => {
  const brokenPaths = rows
    .filter((row) => row.toPageId == null)
    .map((row) => row.toPath);
  if (brokenPaths.length === 0) {
    return [];
  }

  const selfPaths = await findPathsResolvingTo(fromPageId, brokenPaths);

  return brokenPaths
    .filter((path) => !selfPaths.has(path))
    .map((path) => ({ pageId: null, path, targetState: 'broken' }));
};

/**
 * Rows whose cached target id matches no page at all — left behind when a recording raced
 * a permanent delete (the delete cleanup had already run), or when a delete was missed.
 *
 * Existence is checked WITHOUT the viewer condition, so a page the viewer cannot read still
 * counts as present and stays omitted (see `findTrashedTargets`); only an id that no page
 * holds is reported. Like `findBrokenTargets`, the path is the row's own `toPath`.
 */
const findDanglingTargets = async (
  rows: OutboundRow[],
): Promise<ILinkTarget[]> => {
  const rowsWithTarget = rows.flatMap((row) =>
    row.toPageId != null
      ? [{ toPath: row.toPath, toPageId: row.toPageId }]
      : [],
  );
  if (rowsWithTarget.length === 0) {
    return [];
  }

  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const existingPages = await Page.find({
    _id: { $in: rowsWithTarget.map((row) => new Types.ObjectId(row.toPageId)) },
  })
    .select('_id')
    .lean()
    .exec();
  const existingIds = new Set(existingPages.map((page) => page._id.toString()));

  return rowsWithTarget
    .filter((row) => !existingIds.has(row.toPageId))
    .map((row) => ({ pageId: null, path: row.toPath, targetState: 'broken' }));
};

/**
 * `fromPageId`'s outbound links whose target needs the editor's attention — `trashed`
 * or `broken` — among the targets `user` may read.
 *
 * `userGroups` is the viewer's group ids from `findUserGroupIdsForViewer`, resolved
 * once by the caller and shared with its other viewer-filtered reads.
 */
export const findForwardLinkHealth = async (
  fromPageId: Types.ObjectId,
  user: IUser | null,
  userGroups: ObjectIdLike[] | null,
): Promise<ILinkTarget[]> => {
  const rows = await findOutboundRows(fromPageId);

  const [trashed, broken, dangling] = await Promise.all([
    findTrashedTargets(rows, user, userGroups),
    findBrokenTargets(fromPageId, rows),
    findDanglingTargets(rows),
  ]);

  return [...trashed, ...broken, ...dangling];
};
