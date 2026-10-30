// Keeping only the pages this particular person may see (design.md
// `ViewerPageFilter` -- Requirements 3.6, 3.7).
//
// Calling GROWI's existing search with the right arguments is NOT enough. The
// viewer filter the search delegator builds
// (`SearchService`/`ElasticsearchDelegator.filterPagesByViewer`) branches on
// `security:list-policy:hideRestrictedByOwner` and
// `security:list-policy:hideRestrictedByGroup`, both of which default to
// `false` (`server/service/config-manager/config-definition.ts`). Negated,
// that makes `showPagesRestrictedByOwner` / `showPagesRestrictedByGroup`
// TRUE by default, so on a default installation the branches that look at
// `user` and `userGroups` are never taken: owner-, named-user- and
// group-restricted pages all stay in the hits. Only link-only pages are
// dropped. `SearchService.canShowSnippet` then removes the body excerpt but
// leaves the path and the title.
//
// A Gen 2 search result is posted into a chat channel, where everyone
// present reads it, so this feature applies the decision itself before
// answering.
//
// `SearchService.canShowSnippet` must NOT be copied -- it is wrong in both
// directions:
//   - GRANT_SPECIFIED matches none of its four branches and falls through to
//     `return true`, so a page restricted to named users passes for anyone;
//   - for GRANT_USER_GROUP it compares `grantedGroups` -- whose elements are
//     `{ type, item }` -- against plain id strings, so it never matches and a
//     genuine member of the group is dropped.
// The spec beside this file pins both directions.

import type { IUser } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument } from '~/server/models/page';
import { generateGrantCondition } from '~/server/models/page';

/**
 * How many candidates the caller must ask the search for, per result it
 * wants. Dropping happens after the search, so fetching exactly `limit`
 * hits would answer with fewer results than asked for -- and the proxy feeds
 * `SearchResultItem.rank` into `weight / (k + rank)` to interleave several
 * GROWI's results, so a short list changes the final ordering.
 *
 * Over-fetching is not a guarantee: if even this many candidates do not
 * yield `limit` viewable pages, the shorter list is returned as-is.
 */
export const OVER_FETCH_FACTOR = 3;

/** The number of candidates to search for, to answer with `limit` results. */
export const overFetchCount = (limit: number): number =>
  limit * OVER_FETCH_FACTOR;

/**
 * The viewer, in the shape `resolveActor` produces. `user` is `null` both for
 * a chat account with no link and for a linked account that may not operate,
 * and `userGroups` is empty whenever `user` is `null` -- which is exactly
 * Requirement 3.7's case (only pages anyone may read).
 */
export interface ViewerFilterActor {
  readonly user: HydratedDocument<IUser> | null;
  readonly userGroups: ReadonlyArray<ObjectIdLike>;
}

/** The one field this filter needs from a search hit. */
export interface PageCandidate {
  readonly pageId: string;
}

/**
 * Keeps the candidates whose page `actor` may see, in the order given, at
 * most `limit` of them, renumbered from 1.
 *
 * The grant decision is read from the stored page, never from the candidate:
 * the search index carries `path`, various counts, `updated_at`, `tag_names`
 * and `comments`, and none of `grant` / `grantedUsers` / `grantedGroups`.
 * All hit ids are asked for in one query.
 *
 * `generateGrantCondition` is called with two arguments on purpose. Its third
 * parameter, `includeAnyoneWithTheLink`, defaults to `false`; the reference
 * implementation `Page.isAccessiblePageByViewer` passes `true`, and copying
 * that would put link-only (GRANT_RESTRICTED) pages into a chat channel.
 *
 * The condition is applied here rather than inside `findPageListByIds`,
 * which GROWI's own search also uses: adding a filter there would change
 * ordinary search results too.
 *
 * This is NOT the whole of Requirement 3.7. With `user == null` it keeps the
 * pages anyone may read, which is the right answer only where a GROWI shows
 * something to a visitor who is not logged in. In a closed GROWI the search
 * must not run at all, and that decision belongs to the caller: ask
 * `resolveReadDenial` (`../command/resolve-actor`) first and answer with the
 * guidance it returns instead of calling this function.
 */
export const filterPagesForViewer = async <T extends PageCandidate>(
  candidates: readonly T[],
  actor: ViewerFilterActor,
  limit: number,
): Promise<ReadonlyArray<T & { readonly rank: number }>> => {
  if (candidates.length === 0 || limit <= 0) {
    return [];
  }

  const Page = mongoose.model<PageDocument>('Page');
  const viewable = await Page.find({
    _id: { $in: candidates.map((candidate) => candidate.pageId) },
  })
    .and([generateGrantCondition(actor.user, [...actor.userGroups])])
    .select('_id')
    .lean();

  const viewableIds = new Set(viewable.map((page) => page._id.toString()));

  // Filtering the candidates -- rather than mapping over the query results --
  // is what preserves the relevance order the search returned: `$in` gives no
  // ordering guarantee.
  return candidates
    .filter((candidate) => viewableIds.has(candidate.pageId))
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
};
