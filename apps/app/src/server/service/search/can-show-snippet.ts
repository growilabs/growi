import { PageGrant } from '@growi/core';

/**
 * The grant fields of a page, with every id already normalized to a string.
 * Both the Mongo page document and the page_index document can be mapped to this.
 */
export type SnippetGrantFields = {
  readonly grant: number | null | undefined;
  readonly grantedUserIds: readonly string[];
  readonly grantedGroupIds: readonly string[];
};

export type SnippetViewer = {
  readonly userId: string | null;
  /** null for a guest */
  readonly userGroupIds: readonly string[] | null;
};

/**
 * Whether full-text search may show this viewer content (a highlighted
 * fragment) of the page. The list policy (`security:list-policy:*`) only
 * decides whether the page itself is listed; content always follows this rule,
 * which grants the same readers as `generateGrantCondition` in models/page.ts
 * (link-only pages excepted: they are never shown by search). Like that
 * condition, a missing grant (legacy page) is public and any other value is
 * unreadable.
 */
export const canShowSnippetForGrant = (
  page: SnippetGrantFields,
  viewer: SnippetViewer,
): boolean => {
  const { grant } = page;

  if (grant == null || grant === PageGrant.GRANT_PUBLIC) {
    return true;
  }

  if (grant === PageGrant.GRANT_OWNER || grant === PageGrant.GRANT_SPECIFIED) {
    return viewer.userId != null && page.grantedUserIds.includes(viewer.userId);
  }

  if (grant === PageGrant.GRANT_USER_GROUP) {
    const { userGroupIds } = viewer;
    if (userGroupIds == null) return false;
    return page.grantedGroupIds.some((id) => userGroupIds.includes(id));
  }

  return false;
};

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
