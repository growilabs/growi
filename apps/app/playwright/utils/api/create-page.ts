import { PageGrant } from '@growi/core';
import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

interface CreatePageOptions {
  path: string;
  body?: string;
  /** tags to attach — for testing the `tag:` filter */
  pageTags?: string[];
  /** grant level; defaults to GRANT_PUBLIC */
  grant?: PageGrant;
  /** required when grant === USER_GROUP — for testing the `group:` filter */
  grantUserGroupIds?: {
    type: 'UserGroup' | 'ExternalUserGroup';
    item: string;
  }[];
}

/**
 * Create a page via the REST API (POST /_api/v3/page).
 *
 * Authenticates via the cookies carried by the given `request` context — pass a
 * `browser.newContext({ storageState })` request to author the page as a
 * specific user. No token or CSRF header is needed (POST is in the CSRF ignore
 * list).
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
      grant: PageGrant.GRANT_PUBLIC,
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
 * Update a page via PUT /_api/v3/page. The authenticated user becomes the page's
 * last editor — used to set up the `editor:` filter target. Returns the page
 * with its new revision id so the caller can refresh its teardown record.
 */
export const updatePage = async (
  request: APIRequestContext,
  page: CreatedPage,
  body: string,
): Promise<CreatedPage> => {
  const res = await request.put('/_api/v3/page', {
    data: { pageId: page.pageId, revisionId: page.revisionId, body },
  });

  expect(
    res.ok(),
    `updatePage failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  const json = await res.json();
  return {
    pageId: page.pageId,
    path: json.page.path,
    revisionId: json.page.revision?._id ?? json.revision?._id,
  };
};

/**
 * Delete pages completely via POST /_api/v3/pages/delete — teardown for tests.
 * Pass the pages returned by createPage(); the endpoint takes a map of
 * pageId -> revisionId.
 *
 * Asserts the request succeeded: a silent teardown failure leaks pages, which
 * resurfaces as a confusing duplicate-path error on the next run. Note the
 * caller must be allowed to delete every page — a group-restricted page can only
 * be completely deleted by a group member, not by a non-member admin.
 */
export const deletePagesCompletely = async (
  request: APIRequestContext,
  pages: CreatedPage[],
): Promise<void> => {
  if (pages.length === 0) return;

  const pageIdToRevisionIdMap = Object.fromEntries(
    pages.map((p) => [p.pageId, p.revisionId]),
  );
  const res = await request.post('/_api/v3/pages/delete', {
    data: { pageIdToRevisionIdMap, isCompletely: true, isRecursively: true },
  });
  expect(
    res.ok(),
    `deletePagesCompletely failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  // Delete is async: the endpoint returns before the operation finishes, and
  // while it runs it locks the path — so a rerun's create at the same fixed path
  // fails with "Cannot process create". Wait until every page is actually gone.
  // Poll with the deleting context so group-restricted pages stay viewer-visible.
  const uniquePaths = [...new Set(pages.map((p) => p.path))];
  await Promise.all(
    uniquePaths.map((path) =>
      expect
        .poll(
          async () => {
            const existRes = await request.get('/_api/v3/page/exist', {
              params: { path },
            });
            // Keep polling through transient errors rather than asserting here.
            if (!existRes.ok()) return true;
            const { isExist } = await existRes.json();
            return isExist;
          },
          {
            message: `page still exists after delete (operation not finished): ${path}`,
            timeout: 15_000,
          },
        )
        .toBe(false),
    ),
  );
};
