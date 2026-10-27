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

// Plain-keyword search (not the `group:` operator) under `hideRestrictedByGroup`:
// the same page must be visible to a member and hidden from a non-member, proving
// ACL — not missing data — hides it. Own stamp/paths avoid the filter suite.

test.describe
  .serial('search access control', () => {
    const stamp = 'e2e-search-acl-3f9a7c';
    const inGroupPath = `/Sandbox/${stamp}-in-group`;
    const publicControlPath = `/Sandbox/${stamp}-public`;
    const created: CreatedPage[] = [];
    let previousHideRestrictedByGroup = false;

    test.beforeAll(async ({ request, browser }) => {
      // Restricted page + public control share `stamp` so one keyword returns
      // both. A is a member, so it can author the restricted page.
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

      // GLOBAL state: enable for the whole serial suite, restore in afterAll so a
      // failure can't leak it. Read at query time, so no reindex needed.
      previousHideRestrictedByGroup = await setHideRestrictedByGroup(
        request,
        true,
      );
    });

    test.afterAll(async ({ request, browser }) => {
      await setHideRestrictedByGroup(request, previousHideRestrictedByGroup);

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

    test('member still sees their group-restricted page when hideRestrictedByGroup is enabled', async ({
      browser,
    }) => {
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      try {
        const pageA = await contextA.newPage();
        const list = pageA.getByTestId('search-result-list');

        // POSITIVE: member sees the restricted page -> it IS indexed, so the
        // non-member's absence (other test) is ACL, not missing data.
        await expect(async () => {
          await pageA.goto(`/_search?q=${stamp}`);
          await expect(pageA.getByTestId('search-result-base')).toBeVisible();
          await expect(
            list.getByRole('link', { name: `${stamp}-in-group` }),
          ).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 20_000 });
      } finally {
        await contextA.close();
      }
    });

    test('keyword search hides a group-restricted page from non-members when hideRestrictedByGroup is enabled', async ({
      browser,
    }) => {
      const contextB = await browser.newContext({
        storageState: FILTER_TEST_USER_B.authFile,
      });
      try {
        const pageB = await contextB.newPage();
        const list = pageB.getByTestId('search-result-list');

        // POSITIVE: public control appears -> the search ran, so the absence
        // below is meaningful (not just an empty result).
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
      }
    });
  });
