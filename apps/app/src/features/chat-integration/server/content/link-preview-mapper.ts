// Turning a page resolved from a pasted GROWI URL into `@growi/chat`'s
// `link-preview` response (chat-integration-app design.md `LinkPreviewMapper`
// -- Requirements 6.2, 6.3, 6.9-6.12).
//
// What is revealed depends on two independent facts -- the page's grant and
// whether this GROWI lets guests read -- never on WHO pasted the link or who
// else is in the channel (unlike Requirement 3's search, 3.6/3.7). That is
// why this mapper takes no `user`/`userGroups` (`COMMAND_TRAITS.linkPreview.targeting`
// is `'url-matched'`: the URL, not an actor, decides the target):
//   - grant not public (6.3, 6.12): the path only, or for a permalink the
//     fixed unavailable message -- in an open and a closed GROWI alike;
//   - grant public, open GROWI (6.2): the full summary;
//   - grant public, closed GROWI (6.9-6.11): the updated-at plus the path,
//     or for a permalink only the title (last path segment), never the full
//     path, excerpt or comment count.
// The grant is checked first so that no closed-GROWI branch can reach a
// non-public page. The reasoning (why "public" excludes GRANT_RESTRICTED, why
// a permalink gets the title rather than the full path) is in
// chat-integration-app research.md.
//
// `excerpt` truncation length: design.md pins Gen 1's 2000-character body
// truncation (`server/util/slack.js`, referenced at design.md line 415)
// explicitly for `NotificationContent` (task 4.5), not for this mapper. No
// length is stated for link-preview specifically, so the same 2000-character
// convention is reused here by analogy. Task 4.5 confirmed `slack.js` as the
// authoritative source and both mappers now share the constant
// (`./excerpt-length.ts`) so they cannot drift apart independently.
//
// Requirements 6.6-6.8 and 6.12 add a permalink-specific rule on top of the
// above: for a URL that names a page by its 24-hex id rather than its path,
// both "no page has that id" and "a page has that id but its grant is not
// public" must produce the exact same response (`PERMALINK_UNAVAILABLE_MESSAGE`),
// so that probing permalink ids cannot be used to learn which private page
// ids exist. A path-form URL's behavior is unchanged: not-found still
// returns `null` (the caller reports "no such page"), because a path is
// already visible in the pasted URL itself and carries no such probing risk.

import { EXCERPT_LENGTH } from './excerpt-length';
import {
  isPubliclyReadablePage,
  type PublicPageFilterSource,
} from './public-page-filter';
import { titleFromPath } from './title-from-path';

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
 * matched the id, or one did but its grant is not public. Requirements 6.8
 * and 6.12 require these two cases to be indistinguishable to the requester; using
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

  if (!isPubliclyReadablePage(page)) {
    return {
      path: isPermalink ? PERMALINK_UNAVAILABLE_MESSAGE : page.path,
      restricted: true,
    };
  }

  if (!isGuestAllowedToRead) {
    return {
      path: isPermalink ? titleFromPath(page.path) : page.path,
      restricted: true,
      updatedAt: page.updatedAt.toISOString(),
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
