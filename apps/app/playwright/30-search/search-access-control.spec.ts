import { PageGrant } from '@growi/core';
import { expect, test } from '@playwright/test';

import {
  addUserToGroup,
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  ensureUserGroup,
  rebuildSearchIndex,
  setHideRestrictedByGroup,
} from '../utils/api';
import {
  FILTER_GROUP_NAME,
  FILTER_TEST_USER_A,
  FILTER_TEST_USER_B,
} from '../utils/test-users';

// Search results must be filtered by each page's read permission, not just by
// the `group:` operator (which already returns nothing for a non-member). So we
// search by plain keyword — where the restricted page WOULD appear unless ACL
// removes it. Own stamp/paths keep it from colliding with the filter suite.

test.describe
  .serial('search access control', () => {
    const stamp = 'e2e-search-acl-3f9a7c';
    const inGroupPath = `/Sandbox/${stamp}-in-group`;
    const publicControlPath = `/Sandbox/${stamp}-public`;
    const created: CreatedPage[] = [];

    test.beforeAll(async ({ request, browser }) => {
      // A group-restricted page and a public control share `stamp`, so one
      // keyword returns both (subject to ACL). A is a member so it can author
      // the restricted page.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      try {
        const groupId = await ensureUserGroup(request, FILTER_GROUP_NAME);
        await addUserToGroup(request, groupId, FILTER_TEST_USER_A.username);
        created.push(
          await createPage(contextA.request, {
            path: inGroupPath,
            body: `search acl ${stamp}`,
            grant: PageGrant.GRANT_USER_GROUP,
            grantUserGroupIds: [{ type: 'UserGroup', item: groupId }],
          }),
        );
        created.push(
          await createPage(contextA.request, {
            path: publicControlPath,
            body: `search acl ${stamp}`,
          }),
        );
      } finally {
        await contextA.close();
      }

      await rebuildSearchIndex(request);
    });

    test.afterAll(async ({ browser }) => {
      // Only a group member can completely delete a group-restricted page.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      try {
        await deletePagesCompletely(contextA.request, created);
      } finally {
        await contextA.close();
      }
    });

    test('keyword search hides a group-restricted page from non-members when hideRestrictedByGroup is enabled', async ({
      request,
      browser,
    }) => {
      // This is GLOBAL server state; restore it in `finally` so a failure can't
      // leak it. Read at query time, so no reindex is needed after toggling.
      const previousHideRestrictedByGroup = await setHideRestrictedByGroup(
        request,
        true,
      );
      const contextB = await browser.newContext({
        storageState: FILTER_TEST_USER_B.authFile,
      });
      try {
        const pageB = await contextB.newPage();
        const list = pageB.getByTestId('search-result-list');

        // POSITIVE: public control appears -> the search ran, so the restricted
        // page's absence below is meaningful (not just an empty result).
        await expect(async () => {
          await pageB.goto(`/_search?q=${stamp}`);
          await expect(pageB.getByTestId('search-result-base')).toBeVisible();
          await expect(
            list.getByRole('link', { name: `${stamp}-public` }),
          ).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 20_000 });

        // NEGATIVE: ACL hides the group-restricted page from the non-member
        await expect(
          list.getByRole('link', { name: `${stamp}-in-group` }),
        ).toHaveCount(0);
      } finally {
        await contextB.close();
        await setHideRestrictedByGroup(request, previousHideRestrictedByGroup);
      }
    });
  });
