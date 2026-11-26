import type {
  PageGrantIds,
  PageViewerIds,
} from '~/server/util/can-view-page-by-grant';
import { canViewPageByGrant } from '~/server/util/can-view-page-by-grant';

export type SnippetGrantFields = PageGrantIds;

export type SnippetViewer = PageViewerIds;

/**
 * Whether full-text search may show this viewer content (a highlighted
 * fragment) of the page. The list policy (`security:list-policy:*`) only
 * decides whether the page itself is listed; content always follows the page
 * view's rule, except that link-only pages are never shown by search.
 */
export const canShowSnippetForGrant = (
  page: SnippetGrantFields,
  viewer: SnippetViewer,
): boolean =>
  canViewPageByGrant(page, viewer, { includeAnyoneWithTheLink: false });

/** The grant fields as a Mongo page document (lean or not) carries them. */
export type PageGrantDocumentFields = {
  readonly grant?: number | null;
  readonly grantedUsers?: readonly unknown[] | null;
  readonly grantedGroups?: readonly unknown[] | null;
};

/** null when the ref holds no id (a missing or malformed entry). */
const idStringOfRef = (ref: unknown): string | null => {
  if (ref == null) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref !== 'object') return null;
  // a populated document carries its id in _id; an ObjectId stringifies to it
  const id = '_id' in ref && ref._id != null ? ref._id : ref;
  return String(id);
};

const groupItemOf = (entry: unknown): unknown =>
  entry != null && typeof entry === 'object' && 'item' in entry
    ? entry.item
    : undefined;

const nonNullIds = (ids: readonly (string | null)[]): string[] =>
  ids.filter((id): id is string => id != null);

/**
 * Normalizes a page document's grant fields to SnippetGrantFields. A granted
 * group counts only through its `{ item, type }` entry, as in
 * `generateGrantCondition`; entries without an id (legacy or malformed) grant
 * no one instead of failing the search.
 */
export const snippetGrantFieldsOf = (
  page: PageGrantDocumentFields,
): SnippetGrantFields => ({
  grant: page.grant,
  grantedUserIds: nonNullIds((page.grantedUsers ?? []).map(idStringOfRef)),
  grantedGroupIds: nonNullIds(
    (page.grantedGroups ?? []).map((entry) =>
      idStringOfRef(groupItemOf(entry)),
    ),
  ),
});

/** The viewer as page search receives it: the user and the ids of their groups. */
export const snippetViewerOf = (
  user: { readonly _id?: unknown } | null | undefined,
  userGroups: readonly unknown[] | null | undefined,
): SnippetViewer => ({
  userId: user?._id == null ? null : String(user._id),
  userGroupIds: userGroups?.map((id) => String(id)) ?? null,
});

/** Page search's snippet decision for a page document and a viewer. */
export const canShowSnippetOfPage = (
  page: PageGrantDocumentFields,
  user: { readonly _id?: unknown } | null | undefined,
  userGroups: readonly unknown[] | null | undefined,
): boolean =>
  canShowSnippetForGrant(
    snippetGrantFieldsOf(page),
    snippetViewerOf(user, userGroups),
  );
