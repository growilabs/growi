import nodePath from 'node:path';
import type { IUser } from '@growi/core';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { pagePathUtils } from '@growi/core/dist/utils';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { IPageForTreeItem } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import { pageListingService } from '~/server/service/page-listing';
import loggerFactory from '~/utils/logger';
import { toPermalinkMdUrl } from '~/utils/page-markdown-url';

import {
  buildErrorMarkdown,
  buildPageMarkdown,
  type FooterLink,
} from './build-page-markdown';
import { MARKDOWN_FOOTER_MAX_LINKS } from './constants';
import { parseMarkdownRequest } from './parse-markdown-request';

const { encodeSpaces } = pagePathUtils;

const logger = loggerFactory(
  'growi:routes:page-markdown:respond-with-page-markdown',
);

const MARKDOWN_SUFFIX = '.md';

/**
 * The outcome of resolving a markdown request into a response.
 *
 * - 'ok':          the page was resolved and is viewable; `markdown` is the body+footer document.
 * - 'forbidden':   the page exists but the viewer lacks permission; `markdown` is guidance only.
 * - 'notFound':    neither the requested path nor its base resolves; `markdown` is guidance only.
 * - 'passthrough': a literal `.md` page exists at the requested path -> let the existing HTML flow serve it.
 */
export type MarkdownResolution =
  | { type: 'ok'; markdown: string }
  | { type: 'forbidden'; markdown: string }
  | { type: 'notFound'; markdown: string }
  | { type: 'passthrough' };

export interface RespondWithPageMarkdownInput {
  reqPath: string;
  accept: string | undefined;
  formatQuery: string | undefined;
  // NOTE: design.md spells this `IUserHasId | undefined`, but the mandated
  // dependency `findPageAndMetaDataByViewer` requires `opts.user:
  // HydratedDocument<IUser>` and the coding rules forbid type assertions. The
  // route (task 3.1) passes `req.user`, which is exactly this type, so this is
  // the honest, cast-free, route-compatible shape (also assignable to IUserHasId).
  user: HydratedDocument<IUser> | undefined;
  origin: string;
}

type PageDoc = HydratedDocument<PageDocument>;

// Result of the viewer-aware finder used in basicOnly mode. The markdown
// endpoint only needs the page document plus the viewable/forbidden/not-found
// distinction; it does NOT need bookmark counts, deletability, subscription, or
// like status. `basicOnly: true` returns exactly that via the identical
// authorization contract while skipping the extra (Prisma) work -- desirable for
// a crawler-facing read endpoint.
type FinderResult = Awaited<ReturnType<typeof resolvePage>>;

function resolvePage(
  crowi: Crowi,
  target: { pageId: string | null; path: string | null },
  user: HydratedDocument<IUser> | undefined,
) {
  return findPageAndMetaDataByViewer(
    crowi.pageService,
    crowi.pageGrantService,
    {
      pageId: target.pageId,
      path: target.path,
      user,
      basicOnly: true,
    },
  );
}

/**
 * Whether a page exists at the resolved target for THIS viewer's existence
 * check: viewable (data present) OR present-but-forbidden. This mirrors the
 * finder's own re-count semantics and is what literal-wins needs (Requirement
 * 2.1: existence wins over viewability).
 */
function pageExists(result: FinderResult): boolean {
  if (result.data != null) {
    return true;
  }
  // data == null -> meta is IPageNotFoundInfo, which carries isForbidden.
  return result.meta.isForbidden;
}

// Derive a footer link title from a page path: the last path segment, falling
// back to the path itself for the root ('/').
function titleFromPath(path: string): string {
  return nodePath.basename(path) || path;
}

function toFooterLink(
  item: Pick<IPageForTreeItem, '_id' | 'path'>,
): FooterLink {
  return {
    title: titleFromPath(item.path),
    mdUrl: toPermalinkMdUrl(String(item._id)),
  };
}

/**
 * Resolve the parent page's footer link from the child's `parent` ObjectId.
 * The finder does not populate `parent`, so an additional query is required.
 * The parent path is a prefix of the child's path, so resolving it by id
 * exposes nothing new -- a plain findById (no viewer filter) is sufficient.
 */
async function resolveParentLink(
  parent: PageDocument['parent'],
): Promise<FooterLink | null> {
  if (parent == null) {
    return null;
  }
  const Page = mongoose.model<PageDoc, PageModel>('Page');
  const parentPage = await Page.findById(parent).select('_id path').lean();
  if (parentPage == null) {
    return null;
  }
  return {
    title: titleFromPath(parentPage.path),
    mdUrl: toPermalinkMdUrl(String(parentPage._id)),
  };
}

/**
 * Assemble the successful (200) markdown document for a resolved, viewable page.
 *
 * The finder returns the page WITHOUT populated revision / lastUpdateUser /
 * parent (all ObjectIds), so this route helper performs the populate itself --
 * the GROWI convention for read endpoints (see respond-with-single-page.ts).
 */
async function buildOkResolution(
  page: PageDoc,
  user: HydratedDocument<IUser> | undefined,
  origin: string,
): Promise<MarkdownResolution> {
  // Populate body + updater. Empty container pages have no revision; populate
  // leaves it null rather than throwing, so this is safe for empty pages too.
  page.initLatestRevisionField();
  const populated = await page.populateDataToShowRevision(false);

  const pageId = String(populated._id);
  const isEmpty = populated.isEmpty === true;
  const body = isEmpty ? '' : (populated.revision?.body ?? '');

  const updater = populated.lastUpdateUser;
  const updatedByUsername =
    updater != null ? (serializeUserSecurely(updater).username ?? '') : '';
  const updatedAt =
    populated.updatedAt != null
      ? new Date(populated.updatedAt).toISOString()
      : '';

  const parent = await resolveParentLink(populated.parent);

  // Children: at most MARKDOWN_FOOTER_MAX_LINKS links loaded, plus the exact
  // viewer-aware direct-child total (the two share addViewerCondition in the
  // service, so grant logic is not duplicated). descendantCount is separate.
  const children = (
    await pageListingService.findLimitedChildrenByParentIdAndViewer(
      pageId,
      user,
      MARKDOWN_FOOTER_MAX_LINKS,
    )
  ).map(toFooterLink);
  const childrenTotal =
    await pageListingService.countChildrenByParentIdAndViewer(pageId, user);

  // Siblings: only when the page has a parent (root pages have none). Derived
  // from the parent id via the same methods; the page itself is excluded from
  // the list and subtracted from the count so the remainder message stays
  // truthful (Requirement 4.4 / 4.8).
  let siblings: FooterLink[] = [];
  let siblingsTotal = 0;
  if (populated.parent != null) {
    const parentId = String(populated.parent);
    const rawSiblings =
      await pageListingService.findLimitedChildrenByParentIdAndViewer(
        parentId,
        user,
        MARKDOWN_FOOTER_MAX_LINKS,
      );
    siblings = rawSiblings
      .filter((sibling) => String(sibling._id) !== pageId)
      .map(toFooterLink);
    const siblingCountIncludingSelf =
      await pageListingService.countChildrenByParentIdAndViewer(parentId, user);
    siblingsTotal = Math.max(0, siblingCountIncludingSelf - 1);
  }

  const markdown = buildPageMarkdown({
    path: populated.path,
    origin,
    permalinkUrl: `${origin}/${pageId}`,
    canonicalUrl: `${origin}${encodeSpaces(populated.path) ?? populated.path}`,
    body,
    isEmpty,
    parent,
    children,
    childrenTotal,
    descendantCount: populated.descendantCount ?? 0,
    siblings,
    siblingsTotal,
    pageListApiHint: `${origin}/_api/v3/page-listing/children?id=${pageId}`,
    updatedAt,
    updatedByUsername,
  });

  logger.debug({ pageId }, 'markdown resolution: ok');
  return { type: 'ok', markdown };
}

/**
 * Map a finder result into a markdown resolution: viewable -> ok, present but
 * not viewable -> forbidden, otherwise notFound. Authorization decisions come
 * ONLY from the viewer-aware finder (never hand-rolled here).
 */
async function buildFromResult(
  result: FinderResult,
  user: HydratedDocument<IUser> | undefined,
  origin: string,
): Promise<MarkdownResolution> {
  if (result.data != null) {
    return await buildOkResolution(result.data, user, origin);
  }
  if (result.meta.isForbidden) {
    logger.debug('markdown resolution: forbidden');
    return { type: 'forbidden', markdown: buildErrorMarkdown('forbidden') };
  }
  logger.debug('markdown resolution: notFound');
  return { type: 'notFound', markdown: buildErrorMarkdown('notFound') };
}

/**
 * Resolve an incoming request for a page's Markdown representation.
 *
 * Preconditions: the authorization middleware has already run, so `user` is a
 * session/PAT/guest-resolved viewer (or undefined for anonymous). The page
 * returned by the finder is not yet populated.
 * Postconditions: `ok` / `forbidden` / `notFound` carry a `text/markdown` body;
 * `passthrough` carries none and the route factory falls through via next().
 * Invariant: `revision.body` is passed through verbatim.
 */
export async function respondWithPageMarkdown(
  crowi: Crowi,
  input: RespondWithPageMarkdownInput,
): Promise<MarkdownResolution> {
  const { reqPath, accept, formatQuery, user, origin } = input;
  const intent = parseMarkdownRequest(reqPath, accept, formatQuery);

  // Defensive: the route factory calls next() for 'none' before invoking this
  // helper, so this branch is not reached in practice. Return passthrough so
  // the caller falls through to the existing HTML delegate rather than emitting
  // a bogus markdown response.
  if (intent.kind === 'none') {
    return { type: 'passthrough' };
  }

  if (intent.kind === 'permalink') {
    return buildFromResult(
      await resolvePage(crowi, { pageId: intent.pageId, path: null }, user),
      user,
      origin,
    );
  }

  // intent.kind === 'path': resolve the ORIGINAL (unstripped) path first.
  // The literal outcome decides the branch (literal-wins, owned here):
  // - literal exists (viewable OR forbidden) + explicit -> serve THAT page's
  //   markdown / 403; a forbidden literal never falls back to the base
  //   (existence wins -- Requirement 2.4).
  // - literal exists + suffix sugar -> hand off to the existing HTML flow
  //   (Requirement 2.1).
  // - literal absent + `.md` suffix -> strip and resolve the base path
  //   (Requirement 2.2 / 2.3 for sugar, 2.5 for explicit).
  const literal = await resolvePage(
    crowi,
    { pageId: null, path: intent.path },
    user,
  );
  if (pageExists(literal)) {
    if (intent.explicit) {
      return buildFromResult(literal, user, origin);
    }
    logger.debug(
      { reqPath },
      'markdown resolution: passthrough (literal .md page exists)',
    );
    return { type: 'passthrough' };
  }

  if (!intent.path.endsWith(MARKDOWN_SUFFIX)) {
    // Explicit request for a plain path that simply does not resolve.
    return buildFromResult(literal, user, origin);
  }

  const base = intent.path.slice(0, -MARKDOWN_SUFFIX.length);
  if (base.length === 0) {
    // Path was exactly the suffix -> nothing to resolve.
    logger.debug({ reqPath }, 'markdown resolution: notFound (empty base)');
    return { type: 'notFound', markdown: buildErrorMarkdown('notFound') };
  }
  return buildFromResult(
    await resolvePage(crowi, { pageId: null, path: base }, user),
    user,
    origin,
  );
}
