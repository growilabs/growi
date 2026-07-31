import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

import { resolveRedirectEndpoints } from './redirect-endpoint-resolution';

// Match findByPath: exclude empty pages ({ isEmpty: null } for v4 compat).
// Trashed pages are deliberately NOT excluded — a link whose target is in the
// trash resolves to it, so the derived link state can report `trashed` rather
// than `broken`.
const NON_EMPTY_PAGE_CONDITION = {
  $or: [{ isEmpty: false }, { isEmpty: null }],
};

const findPagesByPath = async (
  paths: string[],
): Promise<{ _id: Types.ObjectId; path: string }[]> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  return await Page.find({ path: { $in: paths }, ...NON_EMPTY_PAGE_CONDITION })
    .select('_id path')
    .lean();
};

/**
 * Resolves page IDs for a batch of paths.
 *
 * Inputs are split into permalinks (eg. '/6a4c8be9b698d2b7ab35cd6e') and
 * regular paths (eg. '/docs/new'), each resolved with a single `$in` query.
 * The two queries run concurrently.
 *
 * A regular path with no live page may have been renamed away, so it is then
 * followed through its `PageRedirect` chain and resolved at the chain's endpoint
 * — two further queries, and only when something actually missed. This is what
 * keeps an inbound link valid when its target is renamed and the *source* page
 * is re-saved later: the source body still contains the old path, so without
 * redirect following that re-resolution would report a working link as broken.
 * A permalink never needs this — it encodes the target's immutable `_id`.
 *
 * @param paths - Extracted deduped absolute paths and/or permalinks.
 * @returns - Map from the original input string to its resolved page ID. Keys are
 *            always the input, never a redirect endpoint, so a caller's stored
 *            `toPath` stays faithful to the page body.
 *            Inputs that resolve to no page are absent from the map.
 */
export const resolveToPages = async (
  paths: string[],
): Promise<Map<string, Types.ObjectId>> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  const permalinkIds: string[] = [];
  const normalPaths: string[] = [];

  for (const path of paths) {
    if (isPermalink(path)) {
      permalinkIds.push(removeHeadingSlash(path));
    } else {
      normalPaths.push(path);
    }
  }

  const [byId, byPath] = await Promise.all([
    permalinkIds.length
      ? Page.find({ _id: { $in: permalinkIds } })
          .select('_id')
          .lean()
      : [],
    normalPaths.length ? findPagesByPath(normalPaths) : [],
  ]);

  const result = new Map<string, Types.ObjectId>();

  for (const p of byId) result.set(`/${p._id.toString()}`, p._id);
  for (const p of byPath) result.set(p.path, p._id);

  const missedPaths = normalPaths.filter((path) => !result.has(path));
  if (missedPaths.length === 0) return result;

  const endpointByPath = await resolveRedirectEndpoints(missedPaths);
  if (endpointByPath.size === 0) return result;

  const pagesAtEndpoints = await findPagesByPath([
    ...new Set(endpointByPath.values()),
  ]);

  const idByEndpointPath = new Map<string, Types.ObjectId>();
  for (const p of pagesAtEndpoints) idByEndpointPath.set(p.path, p._id);

  for (const [path, endpointPath] of endpointByPath) {
    const id = idByEndpointPath.get(endpointPath);
    if (id != null) result.set(path, id);
  }

  return result;
};
