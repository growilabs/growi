// Turning already-filtered search hits into `@growi/chat`'s `SearchResultItem`
// (design.md `SearchResultMapper` -- Requirement 3.9).
//
// This is a PURE DATA-SHAPING step, not a permission decision. By the time a
// candidate reaches this module it has already passed `filterPagesForViewer`
// (`./viewer-page-filter.ts`, Requirements 3.6/3.7): that function is the one
// that decides WHICH pages the requester may see. This module only decides
// HOW to render the pages it is handed, so it takes no `user`/`userGroups`.
//
// The task's own words -- "整形済みの表示物ではない" (not a pre-rendered display
// object) -- rule out returning markdown/HTML: the proxy composes the final
// message per chat platform, and a display string baked here would have to be
// re-parsed there. `SearchResultItem`'s fields are returned individually
// instead (Requirement 3.9: "順位・パス・タイトル・URL・更新日時を個別に取り出せる形").
//
// Only the fields declared on `SearchResultPageSource` are read from the
// input page, and only the fields declared on `SearchResultItem` are written
// to the output -- `grant` / `grantedUsers` / `grantedGroups` are never even
// accepted as input, so there is no field to accidentally forward that would
// leak the very permission information `filterPagesForViewer` already used to
// decide this page belongs in the list at all.

import nodePath from 'node:path';
import type { SearchResultItem } from '@growi/chat';
import urljoin from 'url-join';

/**
 * The fields this mapper reads off an already-filtered page. `rank` comes
 * from `filterPagesForViewer`'s own renumbering, not from the search engine,
 * so it is carried through unchanged rather than recomputed here.
 */
export interface SearchResultPageSource {
  readonly rank: number;
  readonly path: string;
  readonly updatedAt: Date;
  readonly commentCount: number;
}

// GROWI pages have no separate title field -- the search index itself only
// carries `path` / counts / `updated_at` / `tag_names` / `comments` (design.md,
// "検索結果だけでは判断できない" section). The last path segment is used as the
// display title, falling back to the full path for the root ("/"), matching
// the existing convention in
// `features/page-markdown/server/services/respond-with-page-markdown.ts`
// (`titleFromPath`).
const titleFromPath = (path: string): string => nodePath.basename(path) || path;

/**
 * Maps already-filtered, already-ranked pages to `SearchResultItem`s.
 *
 * `updatedAt` is written as `Date#toISOString()` -- RFC 3339, always UTC
 * (trailing `Z`), so every chat platform renders the same instant regardless
 * of the GROWI server's local timezone (Requirement 3.9's "日時は決めた表記で"
 * -- design.md: "日時は RFC 3339 の UTC 表記").
 *
 * `siteUrl` is a caller-supplied base URL (`growiInfoService.getSiteUrl()`)
 * rather than looked up here, keeping this function pure and testable without
 * touching GROWI's config/service layer.
 */
export const mapToSearchResultItems = (
  pages: readonly SearchResultPageSource[],
  siteUrl: string,
): ReadonlyArray<SearchResultItem> =>
  pages.map((page) => ({
    rank: page.rank,
    path: page.path,
    title: titleFromPath(page.path),
    url: urljoin(siteUrl, page.path),
    updatedAt: page.updatedAt.toISOString(),
    commentCount: page.commentCount,
  }));
