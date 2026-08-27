import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import type { IPageRedirectEndpoints } from '~/server/models/page-redirect';
import PageRedirect from '~/server/models/page-redirect';

// Match findByPath: exclude empty pages ({ isEmpty: null } for v4 compat).
// Trashed pages are deliberately NOT excluded — a link whose target is in the
// trash resolves to it, so the derived link state can report `trashed` rather
// than `broken`.
const NON_EMPTY_PAGE_CONDITION = {
  $or: [{ isEmpty: false }, { isEmpty: null }],
};

// $graphLookup is memory-bound (100MB, with no spill to disk), so an unbounded
// walk would fail the aggregation outright rather than degrade. This resolution
// runs on every save, so it caps the walk; page view calls the same static
// without a cap, where shortening a chain would 404 an old URL instead.
const REDIRECT_CHAIN_MAX_DEPTH = 50;

// Per call, never at module scope: this module can be imported before crowi
// registers the Page schema, and mongoose.model() throws then.
const getPageModel = () => mongoose.model<PageDocument, PageModel>('Page');

const findPagesById = async (
  ids: string[],
): Promise<{ _id: Types.ObjectId }[]> => {
  return await getPageModel()
    .find({ _id: { $in: ids } })
    .select('_id')
    .lean();
};

const findPagesByPath = async (
  paths: string[],
): Promise<{ _id: Types.ObjectId; path: string }[]> => {
  return await getPageModel()
    .find({ path: { $in: paths }, ...NON_EMPTY_PAGE_CONDITION })
    .select('_id path')
    .lean();
};

/**
 * Resolves page IDs for a batch of paths.
 *
 * Inputs are split into permalinks (eg. '/6a4c8be9b698d2b7ab35cd6e') and regular
 * paths (eg. '/docs/new'). Permalinks are resolved by id; regular paths are
 * resolved the way the page-view route resolves a requested path
 * (`page-data-props.ts`): **a redirect on the path outranks a live page at it**,
 * and only a path with no redirect resolves to its own live page.
 *
 * Following the redirect is what keeps an inbound link valid when its target is
 * renamed and the *source* page is re-saved later: the source body still contains
 * the old path, so without it that re-resolution would report a working link as
 * broken. Matching page view's precedence is what keeps the two from disagreeing
 * when a path both has a live page and kept a redirect — which page creation is
 * supposed to prevent, but does so from a sub-operation that is not awaited and
 * swallows its own failure. A permalink needs none of this: it encodes the
 * target's immutable `_id`, so a rename cannot invalidate it.
 *
 * Cost: three concurrent queries (permalinks by id, paths by path, redirects for
 * every path), plus one more only for chain endpoints the path query did not
 * already cover.
 *
 * @param paths - Extracted deduped absolute paths and/or permalinks.
 * @returns - Map from the original input string to its resolved page ID. Keys are
 *            always the input, never a redirect endpoint, so a caller's stored
 *            `toPath` stays faithful to the page body.
 *            Inputs that resolve to no page are absent from the map.
 */
export const resolveToPageIds = async (
  paths: string[],
): Promise<Map<string, Types.ObjectId>> => {
  const permalinkIds: string[] = [];
  const normalPaths: string[] = [];

  for (const path of paths) {
    if (isPermalink(path)) {
      permalinkIds.push(removeHeadingSlash(path));
    } else {
      normalPaths.push(path);
    }
  }

  const [byId, byPath, endpoints] = await Promise.all([
    permalinkIds.length ? findPagesById(permalinkIds) : [],
    normalPaths.length ? findPagesByPath(normalPaths) : [],
    normalPaths.length
      ? PageRedirect.retrievePageRedirectEndpointsBatch(
          normalPaths,
          REDIRECT_CHAIN_MAX_DEPTH,
        )
      : new Map<string, IPageRedirectEndpoints>(),
  ]);

  const result = new Map<string, Types.ObjectId>();
  for (const p of byId) result.set(`/${p._id.toString()}`, p._id);

  const idByLivePath = new Map<string, Types.ObjectId>();
  for (const p of byPath) idByLivePath.set(p.path, p._id);

  // A cycle does not leave a chain unresolved: $graphLookup visits each document
  // once, so it comes back to the starting document, which is then the deepest
  // hop — the endpoint collapses to the start's own next hop. Never a hang, and
  // page view lands on the same hop.
  const endpointPathByInput = new Map<string, string>();
  for (const [path, { end }] of endpoints) {
    endpointPathByInput.set(path, end.toPath);
  }

  // The first query already answered every requested path, including with "no
  // live page" — so ask only for endpoints outside that set.
  const queriedPaths = new Set(normalPaths);
  const unknownEndpointPaths = [
    ...new Set(endpointPathByInput.values()),
  ].filter((endpointPath) => !queriedPaths.has(endpointPath));

  if (unknownEndpointPaths.length > 0) {
    for (const p of await findPagesByPath(unknownEndpointPaths)) {
      idByLivePath.set(p.path, p._id);
    }
  }

  for (const path of normalPaths) {
    const id = idByLivePath.get(endpointPathByInput.get(path) ?? path);
    if (id != null) result.set(path, id);
  }

  return result;
};
