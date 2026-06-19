import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
  updatePage,
} from '../utils/CreatePage';
import { rebuildSearchIndex } from '../utils/SearchIndex';
import { FILTER_TEST_USER_A, FILTER_TEST_USER_B } from '../utils/test-users';

test.describe
  .serial('tag filter relevance', () => {
    // Unique keyword so the matching set is deterministic and survives seed data.
    const stamp = 'e2e-tagfilter-0a1b2c';
    const tag = `mytag-xyz789${stamp}`;
    const targetPath = `/Sandbox/${stamp}-target`;
    const controlPath = `/Sandbox/${stamp}-control`;
    let created: CreatedPage[] = [];

    // Teardown — keep the DB clean so the suite is re-runnable.
    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('setup: create a matching page and a control page', async ({
      request,
    }) => {
      const target = await createPage(request, {
        path: targetPath,
        body: 'matching page',
        pageTags: [tag], // what `tag:` will match
      });
      const control = await createPage(request, {
        path: controlPath,
        body: 'control page', // no tag -> must NOT appear
      });
      created = [target, control];
    });

    test('tag filter returns only the tagged page', async ({
      page,
      request,
    }) => {
      await rebuildSearchIndex(request);

      const list = page.getByTestId('search-result-list');

      // rebuild runs asynchronously on the server; re-run the search until the
      // tagged page shows up (toPass retries the whole block until it passes).
      // POSITIVE: the tagged page appears.
      await expect(async () => {
        await page.goto(`/_search?q=tag:${tag}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${stamp}-target` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: the untagged control page does not appear -> proves relevance.
      await expect(
        list.getByRole('link', { name: `${stamp}-control` }),
      ).toHaveCount(0);
    });
  });

test.describe
  .serial('author filter relevance', () => {
    // `author:<username>` matches the page creator's username.
    const stamp = 'e2e-authorfilter-7f3a2b';
    const byUserAPath = `/Sandbox/${stamp}-by-a`;
    const byUserBPath = `/Sandbox/${stamp}-by-b`;
    let created: CreatedPage[] = [];

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('setup: create pages authored by different users', async ({
      browser,
    }) => {
      // Each context carries a different user's saved session.
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      const contextB = await browser.newContext({
        storageState: FILTER_TEST_USER_B.authFile,
      });
      try {
        const byA = await createPage(contextA.request, {
          path: byUserAPath,
          body: `author filter ${stamp}`,
        });
        const byB = await createPage(contextB.request, {
          path: byUserBPath,
          body: `author filter ${stamp}`,
        });
        created = [byA, byB];
      } finally {
        await contextA.close();
        await contextB.close();
      }
    });

    test('author filter returns only pages by that author', async ({
      page,
      request,
    }) => {
      await rebuildSearchIndex(request);

      const list = page.getByTestId('search-result-list');

      // POSITIVE: only user A's page appears for `author:<A>`.
      await expect(async () => {
        await page.goto(`/_search?q=author:${FILTER_TEST_USER_A.username}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${stamp}-by-a` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: user B's page does not appear -> proves the author filter.
      await expect(
        list.getByRole('link', { name: `${stamp}-by-b` }),
      ).toHaveCount(0);
    });
  });

test.describe
  .serial('editor filter relevance', () => {
    // `editor:<username>` matches the page's last editor (last_update_username).
    const stamp = 'e2e-editorfilter-9c4d1e';
    const editedByBPath = `/Sandbox/${stamp}-edited-by-b`;
    const onlyByAPath = `/Sandbox/${stamp}-only-a`;
    let created: CreatedPage[] = [];

    test.afterAll(async ({ request }) => {
      await deletePagesCompletely(request, created);
    });

    test('setup: page last edited by B, control edited only by A', async ({
      browser,
    }) => {
      const contextA = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
      });
      const contextB = await browser.newContext({
        storageState: FILTER_TEST_USER_B.authFile,
      });
      try {
        // Created by A, then last-edited by B -> last editor is B.
        const createdByA = await createPage(contextA.request, {
          path: editedByBPath,
          body: `editor filter ${stamp}`,
        });
        const editedByB = await updatePage(
          contextB.request,
          createdByA,
          `editor filter ${stamp} edited by b`,
        );

        // Created and edited only by A -> last editor is A (control).
        const onlyA = await createPage(contextA.request, {
          path: onlyByAPath,
          body: `editor filter ${stamp}`,
        });
        created = [editedByB, onlyA];
      } finally {
        await contextA.close();
        await contextB.close();
      }
    });

    test('editor filter returns only pages last edited by that user', async ({
      page,
      request,
    }) => {
      await rebuildSearchIndex(request);

      const list = page.getByTestId('search-result-list');

      // POSITIVE: only the page last edited by B appears for `editor:<B>`.
      await expect(async () => {
        await page.goto(`/_search?q=editor:${FILTER_TEST_USER_B.username}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${stamp}-edited-by-b` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });

      // NEGATIVE: the page only A ever edited does not appear.
      await expect(
        list.getByRole('link', { name: `${stamp}-only-a` }),
      ).toHaveCount(0);
    });
  });
