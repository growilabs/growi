import { PageGrant } from '@growi/core';
import { expect, test } from '@playwright/test';

import {
  addUserToGroup,
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  ensureUserGroup,
  rebuildSearchIndex,
  updatePage,
} from '../utils/api';
import {
  FILTER_GROUP_NAME,
  FILTER_TEST_USER_A,
  FILTER_TEST_USER_B,
} from '../utils/test-users';

// Create all fixtures first, rebuild the index ONCE (beforeAll), then each test
// only re-runs its search.
//
// Why rebuild instead of auto-index + poll: auto-indexing is event-driven and
// unordered (search.ts:registerUpdateEvent), so a page with >1 index event races
// — e.g. an editor page created by A then edited by B can keep editor=A if the
// create-write lands last, and a per-page poll never converges (~2/10 failures).
// A rebuild re-reads the final DB state and is authoritative.
//
// Why ONE rebuild for all filters: it reindexes the WHOLE collection, and each
// filter uses a unique stamp, so a single rebuild after every fixture exists
// covers them all. `toPass` still polls (the rebuild runs async server-side);
// the suite stays `describe.serial` so two rebuilds can't overlap.

test.describe
  .serial('search filters', () => {
    // --- tag filter: `tag:` matches a page's tags ---
    // Unique keyword so the matching set is deterministic and survives seed data.
    const tagStamp = 'e2e-tagfilter-0a1b2c';
    const tag = `mytag-xyz789${tagStamp}`;
    const tagTargetPath = `/Sandbox/${tagStamp}-target`;
    const tagControlPath = `/Sandbox/${tagStamp}-control`;
    const createdTag: CreatedPage[] = [];

    // --- author filter: `author:<username>` matches the page creator's username ---
    const authorStamp = 'e2e-authorfilter-7f3a2b';
    const authorByAPath = `/Sandbox/${authorStamp}-by-a`;
    const authorByBPath = `/Sandbox/${authorStamp}-by-b`;
    const createdAuthor: CreatedPage[] = [];

    // --- editor filter: `editor:<username>` matches last_update_username ---
    const editorStamp = 'e2e-editorfilter-9c4d1e';
    const editorEditedByBPath = `/Sandbox/${editorStamp}-edited-by-b`;
    const editorOnlyByAPath = `/Sandbox/${editorStamp}-only-a`;
    const editorAuthoredByBPath = `/Sandbox/${editorStamp}-authored-by-b`;
    const createdEditor: CreatedPage[] = [];

    // --- group filter: `group:<name>` matches pages granted to that user group ---
    const groupStamp = 'e2e-groupfilter-2b8e6d';
    const groupInGroupPath = `/Sandbox/${groupStamp}-in-group`;
    const groupPublicControlPath = `/Sandbox/${groupStamp}-public`;
    const createdGroup: CreatedPage[] = [];

    // --- prefix filter: `prefix:<path>` matches pages whose path starts with it ---
    const prefixStamp = 'e2e-prefixfilter-4d7c1a';
    const prefixTargetPath = `/Sandbox/${prefixStamp}-inc-target`;
    const prefixControlPath = `/Sandbox/${prefixStamp}-exc-control`;
    const createdPrefix: CreatedPage[] = [];

    // --- negated author filter: `-author:` excludes an author. A bare `-author:`
    // matches every page except one, so scope it with a unique `prefix:` to keep
    // the result set deterministic. ---
    const notAuthorStamp = 'e2e-notauthorfilter-8e2f0b';
    const notAuthorPrefix = `/Sandbox/${notAuthorStamp}`;
    const notAuthorByAPath = `${notAuthorPrefix}-by-a`;
    const notAuthorByBPath = `${notAuthorPrefix}-by-b`;
    const createdNotAuthor: CreatedPage[] = [];

    // Create EVERY fixture across all filters, then rebuild the index once. The
    // rebuild must run after the last create/update so addAllPages reads the final
    // DB state for every page.
    test.beforeAll(async ({ request, browser }) => {
      // Author/editor/group/negated-author fixtures need specific users; each
      // context carries a different user's saved session.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      const contextB = await browser.newContext({
        storageState: FILTER_TEST_USER_B.authFile,
      });
      try {
        // tag: one tagged page (matches) and one untagged control.
        createdTag.push(
          await createPage(request, {
            path: tagTargetPath,
            body: 'matching page',
            pageTags: [tag],
          }),
        );
        createdTag.push(
          await createPage(request, {
            path: tagControlPath,
            body: 'control page', // no tag -> must NOT appear
          }),
        );

        // author: one page per user, authored by different creators.
        createdAuthor.push(
          await createPage(contextA.request, {
            path: authorByAPath,
            body: `author filter ${authorStamp}`,
          }),
        );
        createdAuthor.push(
          await createPage(contextB.request, {
            path: authorByBPath,
            body: `author filter ${authorStamp}`,
          }),
        );

        // editor: for updated pages we push both results — deletePagesCompletely
        // dedups by pageId keeping the last entry, so the update's newer
        // revisionId wins, while the create push covers a failure between the two.

        // Created by A, then last-edited by B -> last editor is B (target).
        const editorCreatedByA = await createPage(contextA.request, {
          path: editorEditedByBPath,
          body: `editor filter ${editorStamp}`,
        });
        createdEditor.push(editorCreatedByA);
        createdEditor.push(
          await updatePage(
            contextB.request,
            editorCreatedByA,
            `editor filter ${editorStamp} edited by b`,
          ),
        );

        // Created and edited only by A -> last editor is A (control).
        createdEditor.push(
          await createPage(contextA.request, {
            path: editorOnlyByAPath,
            body: `editor filter ${editorStamp}`,
          }),
        );

        // Authored by B but last-edited by A -> last editor is A.
        // Proves the filter keys on the LAST editor.
        const editorCreatedByB = await createPage(contextB.request, {
          path: editorAuthoredByBPath,
          body: `editor filter ${editorStamp}`,
        });
        createdEditor.push(editorCreatedByB);
        createdEditor.push(
          await updatePage(
            contextA.request,
            editorCreatedByB,
            `editor filter ${editorStamp} edited by a`,
          ),
        );

        // group: admin creates the group and adds user A as a member, then A
        // creates a group-restricted page and a public control.
        const groupId = await ensureUserGroup(request, FILTER_GROUP_NAME);
        await addUserToGroup(request, groupId, FILTER_TEST_USER_A.username);
        createdGroup.push(
          await createPage(contextA.request, {
            path: groupInGroupPath,
            body: `group filter ${groupStamp}`,
            grant: PageGrant.GRANT_USER_GROUP,
            grantUserGroupIds: [{ type: 'UserGroup', item: groupId }],
          }),
        );
        createdGroup.push(
          await createPage(contextA.request, {
            path: groupPublicControlPath,
            body: `group filter ${groupStamp}`,
          }),
        );

        // prefix: one page under the prefix and one outside it.
        createdPrefix.push(
          await createPage(request, {
            path: prefixTargetPath,
            body: `prefix filter ${prefixStamp}`,
          }),
        );
        createdPrefix.push(
          await createPage(request, {
            path: prefixControlPath,
            body: `prefix filter ${prefixStamp}`,
          }),
        );

        // negated author: two pages under one prefix, authored by different users.
        createdNotAuthor.push(
          await createPage(contextA.request, {
            path: notAuthorByAPath,
            body: `not-author filter ${notAuthorStamp}`,
          }),
        );
        createdNotAuthor.push(
          await createPage(contextB.request, {
            path: notAuthorByBPath,
            body: `not-author filter ${notAuthorStamp}`,
          }),
        );
      } finally {
        await contextA.close();
        await contextB.close();
      }

      await rebuildSearchIndex(request);
    });

    // Tear everything down once at the very end, so the suite stays re-runnable
    // (a leaked page collides on the next run's fixed path).
    test.afterAll(async ({ request, browser }) => {
      // The group-restricted page can only be completely deleted by a group member
      // (user A), not by a non-member admin — so delete the group pages as A.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      try {
        await deletePagesCompletely(contextA.request, createdGroup);
      } finally {
        await contextA.close();
      }

      // The rest are public pages; admin can delete them regardless of author.
      await deletePagesCompletely(request, [
        ...createdTag,
        ...createdAuthor,
        ...createdEditor,
        ...createdPrefix,
        ...createdNotAuthor,
      ]);
    });

    test('tag filter returns only the tagged page', async ({ page }) => {
      const list = page.getByTestId('search-result-list');

      // POSITIVE: tagged page appears
      await expect(async () => {
        await page.goto(`/_search?q=tag:${tag}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${tagStamp}-target` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: untagged control absent -> proves relevance
      await expect(
        list.getByRole('link', { name: `${tagStamp}-control` }),
      ).toHaveCount(0);
    });

    test('author filter returns only pages by that author', async ({
      page,
    }) => {
      const list = page.getByTestId('search-result-list');

      // POSITIVE: only A's page appears
      await expect(async () => {
        await page.goto(`/_search?q=author:${FILTER_TEST_USER_A.username}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${authorStamp}-by-a` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: B's page absent -> proves the author filter
      await expect(
        list.getByRole('link', { name: `${authorStamp}-by-b` }),
      ).toHaveCount(0);
    });

    test('editor filter returns only pages last edited by that user', async ({
      page,
    }) => {
      const list = page.getByTestId('search-result-list');

      // POSITIVE: only the page last edited by B appears
      await expect(async () => {
        await page.goto(`/_search?q=editor:${FILTER_TEST_USER_B.username}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${editorStamp}-edited-by-b` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: page only A edited absent
      await expect(
        list.getByRole('link', { name: `${editorStamp}-only-a` }),
      ).toHaveCount(0);

      // NEGATIVE: B-authored but A-edited absent -> proves editor: is the LAST editor
      await expect(
        list.getByRole('link', { name: `${editorStamp}-authored-by-b` }),
      ).toHaveCount(0);
    });

    test('group filter returns only pages granted to that group', async ({
      browser,
    }) => {
      // Search as user A (a group member) — `group:` resolves the name against the
      // searcher's own memberships.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      try {
        const pageA = await contextA.newPage();
        const list = pageA.getByTestId('search-result-list');

        // POSITIVE: group-restricted page appears
        await expect(async () => {
          await pageA.goto(`/_search?q=group:${FILTER_GROUP_NAME}`);
          await expect(pageA.getByTestId('search-result-base')).toBeVisible();
          await expect(
            list.getByRole('link', { name: `${groupStamp}-in-group` }),
          ).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 20_000 });

        // NEGATIVE: public (non-group) page absent
        await expect(
          list.getByRole('link', { name: `${groupStamp}-public` }),
        ).toHaveCount(0);
      } finally {
        await contextA.close();
      }
    });

    test('prefix filter returns only pages under that path', async ({
      page,
    }) => {
      const list = page.getByTestId('search-result-list');

      // POSITIVE: page under the prefix appears
      await expect(async () => {
        await page.goto(`/_search?q=prefix:/Sandbox/${prefixStamp}-inc`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${prefixStamp}-inc-target` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: page outside the prefix absent
      await expect(
        list.getByRole('link', { name: `${prefixStamp}-exc-control` }),
      ).toHaveCount(0);
    });

    test('negated author filter excludes that author within the scope', async ({
      page,
    }) => {
      const list = page.getByTestId('search-result-list');

      // POSITIVE: A's page found within the prefix scope
      await expect(async () => {
        await page.goto(
          `/_search?q=prefix:${notAuthorPrefix} -author:${FILTER_TEST_USER_B.username}`,
        );
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${notAuthorStamp}-by-a` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: B's page excluded by -author:<B>
      await expect(
        list.getByRole('link', { name: `${notAuthorStamp}-by-b` }),
      ).toHaveCount(0);
    });
  });
