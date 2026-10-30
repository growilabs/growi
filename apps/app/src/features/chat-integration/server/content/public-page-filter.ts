// Judging whether a page is readable by anyone, regardless of who is asking
// (design.md's `PublicPageFilter` -- Requirements 2.3, 6.3).
//
// This is a different question from `ViewerPageFilter`'s (`./viewer-page-filter.ts`):
// that one asks "can THIS actor see this page" and needs `user`/`userGroups` plus a
// database round-trip to re-fetch full page documents (search hits carry `path`,
// counts, `updated_at`, `tag_names`, `comments` -- never `grant`). This filter asks
// "would ANY visitor, logged in or not, be allowed to read this page", which does not
// depend on any actor at all, so the function below takes no `user`/`userGroups`
// parameter -- there is no actor-shaped value to even accept.
//
// Both call sites design.md names already hold a full page document for their own
// purposes before they ask this question:
//   - notification content generation builds the notification body from the page
//     that was just saved, and only needs to know whether to keep or drop that body
//     (Requirement 2.3);
//   - link preview mapping loads the page referenced by the pasted URL to build its
//     summary, and only needs to know whether to keep or drop the excerpt/date/
//     comment-count fields (Requirement 6.3).
// Neither caller has a bare search hit in hand at this point, so this filter takes an
// already-fetched page (or anything carrying its `grant` field) and returns a plain
// boolean -- no query, no re-fetch.
//
// `{ grant: null }` is treated as publicly readable, matching `generateGrantCondition`
// (`~/server/models/page`), which puts `{ grant: null }` alongside `{ grant: GRANT_PUBLIC }`
// in its own "anyone may read" branch -- a legacy page saved before the `grant` field
// existed defaults to the same "anyone may read" outcome GROWI's own grant-aware query
// already gives it, and treating it differently here would fork the definition of
// "publicly readable" between this filter and `generateGrantCondition`.

import { PageGrant } from '@growi/core';

/** The one field this judgment needs from an already-fetched page. */
export interface PublicPageFilterSource {
  readonly grant: PageGrant | null | undefined;
}

/**
 * Whether `page` is readable by any visitor, logged in or not.
 *
 * Takes no actor: the answer never depends on who asks. `GRANT_PUBLIC` and the
 * legacy `null`/`undefined` grant are the only "anyone may read" cases -- every
 * other grant (`GRANT_RESTRICTED`, `GRANT_SPECIFIED`, `GRANT_OWNER`,
 * `GRANT_USER_GROUP`) requires knowing who is asking, so none of them qualify here,
 * not even for the specific user/owner/group member who could see the page.
 */
export const isPubliclyReadablePage = (page: PublicPageFilterSource): boolean =>
  page.grant == null || page.grant === PageGrant.GRANT_PUBLIC;
