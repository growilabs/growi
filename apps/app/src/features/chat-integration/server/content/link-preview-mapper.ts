// Turning a page resolved from a pasted GROWI URL into `@growi/chat`'s
// `link-preview` response (design.md `LinkPreviewMapper` -- Requirements
// 6.2, 6.3).
//
// Requirement 6 draws exactly two states, both independent of WHO pasted the
// link or who else is in the channel:
//   6.2 -- the page is one anyone may read: include the body excerpt,
//          updated-at and comment count.
//   6.3 -- the page is not one anyone may read: include nothing but the path.
// Neither acceptance criterion mentions the individual requester's own view
// permission, unlike Requirement 3 (search, 3.6/3.7) which explicitly does.
// That is why this mapper takes no `user`/`userGroups` -- there is no
// actor-shaped question for it to answer, and adding one would invent a rule
// Requirement 6 does not state (`COMMAND_TRAITS.linkPreview.targeting` is
// `'url-matched'`, not `'single'`: the URL, not an actor, decides the
// target).
//
// design.md's "PublicPageFilter を呼ぶ側も、閉じた GROWI での扱いを決める" table adds
// a second, GROWI-wide gate on top of 6.2/6.3's page-level one: in a closed
// GROWI (`aclService.isGuestAllowedToRead()` false), link expansion is
// path-only EVEN FOR a GRANT_PUBLIC page -- "本文の冒頭・更新日時・コメント数を出さない
// ... URL を貼った本人が中身を知っていても、チャンネルの全員がそうとは限らない" does not carve
// out an exception for a publicly-graned page. So the full summary requires
// BOTH `isPubliclyReadablePage(page)` AND `isGuestAllowedToRead` -- either one
// being false collapses to path-only.
//
// `excerpt` truncation length: design.md pins Gen 1's 2000-character body
// truncation (`server/util/slack.js`, referenced at design.md line 415)
// explicitly for `NotificationContent` (task 4.5), not for this mapper. No
// length is stated for link-preview specifically, so the same 2000-character
// convention is reused here by analogy. Task 4.5 confirmed `slack.js` as the
// authoritative source and both mappers now share the constant
// (`./excerpt-length.ts`) so they cannot drift apart independently.
//
// Requirements 6.6-6.8 add a permalink-specific exception on top of the
// above: for a URL that names a page by its 24-hex id rather than its path,
// both "no page has that id" and "a page has that id but is not publicly
// readable" must produce the exact same response (`PERMALINK_UNAVAILABLE_MESSAGE`),
// so that probing permalink ids cannot be used to learn which private page
// ids exist. A path-form URL's behavior is unchanged: not-found still
// returns `null` (the caller reports "no such page"), because a path is
// already visible in the pasted URL itself and carries no such probing risk.

import { EXCERPT_LENGTH } from './excerpt-length';
import {
  isPubliclyReadablePage,
  type PublicPageFilterSource,
} from './public-page-filter';

/** The fields this mapper reads off a resolved page. */
export interface LinkPreviewPageSource extends PublicPageFilterSource {
  readonly path: string;
  /** Full markdown body; truncated to `EXCERPT_LENGTH` characters here. */
  readonly body: string;
  readonly updatedAt: Date;
  readonly commentCount: number;
}

/** `@growi/chat`'s `link-preview` response, minus its `kind` discriminant. */
export interface LinkPreviewResult {
  readonly path: string;
  readonly restricted: boolean;
  readonly excerpt?: string;
  readonly updatedAt?: string;
  readonly commentCount?: number;
}

/**
 * `resolvePageFromUrl`'s result (design.md's `ResolvedUrlTarget`), as seen by
 * this mapper. Declared here rather than imported from
 * `command/command-endpoint.ts` so this module stays free of a dependency on
 * the command layer that calls it; `ResolvedLinkPreviewPage` there is
 * structurally identical to `LinkPreviewPageSource` (both are "the fields
 * this mapper reads off a resolved page"), so a `ResolvedUrlTarget` produced
 * by `resolvePageFromUrl` is assignable here without any conversion.
 */
export interface LinkPreviewUrlTarget {
  /** Whether the trailing URL segment was a 24-hex-char permalink identifier, rather than a path. */
  readonly isPermalink: boolean;
  /** The resolved page, or null if no page matched. */
  readonly page: LinkPreviewPageSource | null;
}

/**
 * Fixed response text for a permalink that cannot be shown -- either no page
 * matched the id, or one did but is not publicly readable. Requirement 6.8
 * requires these two cases to be indistinguishable to the requester; using
 * one shared constant for both call sites is what keeps them byte-identical
 * as this file changes, rather than relying on two separately-written
 * strings that could drift apart.
 */
export const PERMALINK_UNAVAILABLE_MESSAGE =
  'This page does not exist, or is not visible to everyone.';

/**
 * Builds the link-preview summary for `target`.
 *
 * `isGuestAllowedToRead` is caller-supplied (`crowi.aclService.isGuestAllowedToRead()`),
 * same pattern as `resolveActor`'s `resolveReadDenial` -- keeping the lookup
 * out of this module leaves it pure and testable.
 *
 * Returns `null` only when `target.page` is `null` and `target.isPermalink`
 * is `false` -- a path-form URL that matched no page, which the caller turns
 * into `errorResponse('invalid')`. Every other case (including "permalink,
 * not found") returns a `LinkPreviewResult`, per Requirement 6.8: a
 * not-found permalink must not be distinguishable from a found-but-private
 * one.
 */
export const buildLinkPreview = (
  target: LinkPreviewUrlTarget,
  isGuestAllowedToRead: boolean,
): LinkPreviewResult | null => {
  const { page, isPermalink } = target;

  if (page == null) {
    if (!isPermalink) {
      return null;
    }
    return { path: PERMALINK_UNAVAILABLE_MESSAGE, restricted: true };
  }

  const isFullSummaryAllowed =
    isPubliclyReadablePage(page) && isGuestAllowedToRead;

  if (!isFullSummaryAllowed) {
    return {
      path: isPermalink ? PERMALINK_UNAVAILABLE_MESSAGE : page.path,
      restricted: true,
    };
  }

  return {
    path: page.path,
    restricted: false,
    excerpt: page.body.slice(0, EXCERPT_LENGTH),
    updatedAt: page.updatedAt.toISOString(),
    commentCount: page.commentCount,
  };
};
