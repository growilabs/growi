import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/CreatePage';

test.describe
  .serial('tag filter relevance', () => {
    // Unique keyword so the matching set is deterministic and survives seed data.
    const stamp = 'e2e-tagfilter-0a1b2c';
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
        pageTags: [stamp], // this is what `tag:` will match
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
      // Page indexing into Elasticsearch is event-driven and decoupled from
      // creation, so a just-created page may not be searchable yet. Trigger an
      // explicit reindex (admin-only) to make the test deterministic.
      const res = await request.put('/_api/v3/search/indices', {
        data: { operation: 'rebuild' },
      });
      expect(
        res.ok(),
        `reindex request failed: ${res.status()} ${await res.text()}`,
      ).toBe(true);

      const list = page.getByTestId('search-result-list');

      // rebuild runs asynchronously on the server; re-run the search until the
      // tagged page shows up (toPass retries the whole block until it passes).
      // POSITIVE: the tagged page appears.
      await expect(async () => {
        await page.goto(`/_search?q=tag:${stamp}`);
        await expect(page.getByTestId('search-result-base')).toBeVisible();
        await expect(
          list.getByRole('link', { name: `${stamp}-target` }),
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 60_000 });

      // NEGATIVE: the untagged control page does not appear -> proves relevance.
      await expect(
        list.getByRole('link', { name: `${stamp}-control` }),
      ).toHaveCount(0);
    });
  });
