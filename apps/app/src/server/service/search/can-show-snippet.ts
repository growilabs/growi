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
