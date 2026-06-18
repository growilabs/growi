import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

// GROWI page grant levels (see @growi/core PageGrant)
export const Grant = {
  PUBLIC: 1,
  RESTRICTED: 2,
  OWNER: 4,
  USER_GROUP: 5,
} as const;

interface CreatePageOptions {
  path: string;
  body?: string;
  /** tags to attach — for testing the `tag:` filter */
  pageTags?: string[];
  /** grant level; defaults to PUBLIC */
  grant?: number;
  /** required when grant === USER_GROUP — for testing the `group:` filter */
  grantUserGroupIds?: {
    type: 'UserGroup' | 'ExternalUserGroup';
    item: string;
  }[];
}

/**
 * Create a page via the REST API (POST /_api/v3/page).
 *
 * Uses Playwright's `request` fixture, which reuses the stored admin session
 * cookies — so the call is authenticated without any token or CSRF header
 * (POST is in the CSRF ignore list).
 *
 * Returns the created page's id so the test can clean it up afterwards.
 */
export interface CreatedPage {
  pageId: string;
  path: string;
  /** latest revision id — required to delete the page later */
  revisionId: string;
}

export const createPage = async (
  request: APIRequestContext,
  options: CreatePageOptions,
): Promise<CreatedPage> => {
  const res = await request.post('/_api/v3/page', {
    data: {
      grant: Grant.PUBLIC,
      ...options,
    },
  });

  // Fail loudly with the server's message if setup didn't succeed.
  expect(
    res.ok(),
    `createPage failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  const json = await res.json();
  return {
    pageId: json.page._id,
    path: json.page.path,
    revisionId: json.page.revision?._id ?? json.revision?._id,
  };
};

/**
 * Delete pages completely via POST /_api/v3/pages/delete. Best-effort teardown
 * for tests — pass the pages returned by createPage(). The endpoint takes a
 * map of pageId -> revisionId.
 */
export const deletePagesCompletely = async (
  request: APIRequestContext,
  pages: CreatedPage[],
): Promise<void> => {
  if (pages.length === 0) return;

  const pageIdToRevisionIdMap = Object.fromEntries(
    pages.map((p) => [p.pageId, p.revisionId]),
  );
  await request.post('/_api/v3/pages/delete', {
    data: { pageIdToRevisionIdMap, isCompletely: true, isRecursively: true },
  });
};
