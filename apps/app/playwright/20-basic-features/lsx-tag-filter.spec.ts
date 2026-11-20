import { expect, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api';

/**
 * E2E coverage for Task 6.2 -- $lsx `tag` option: hierarchical rendering,
 * total count, and "Load more" pagination (Requirements 4.1, 4.2).
 *
 * Fixture layout (mirrors search-filters.spec.ts's target/control pattern):
 *   /Sandbox/<stamp>-lsx-tag-e2e             <- parent page; body holds the
 *                                                $lsx(...) directive
 *   /Sandbox/<stamp>-lsx-tag-e2e/tagged-1    <- tagged with the test tag (target)
 *   /Sandbox/<stamp>-lsx-tag-e2e/tagged-2    <- tagged with the test tag (target)
 *   /Sandbox/<stamp>-lsx-tag-e2e/untagged    <- no tag (negative control)
 *
 * The parent's body is `$lsx(<parentPath>, tag=<tag>, num=1)`. `num=1` forces
 * the initial page size down to one match even though there are two tagged
 * pages, so the "Load more" / remaining-count state is reached deterministically
 * with only two fixture pages, instead of needing enough pages to exceed the
 * default page size (see packages/remark-lsx's
 * add-num-condition.ts DEFAULT_PAGES_NUM=50 and
 * client/stores/lsx/parse-num-option.ts, which treats a plain integer `num`
 * value as the fetch `limit`).
 */
test.describe('$lsx tag filter', () => {
  const stamp = `e2e-lsxtag-${Date.now()}`;
  const tag = `lsx-e2e-tag-${stamp}`;
  const parentPath = `/Sandbox/${stamp}-lsx-tag-e2e`;
  const tagged1Path = `${parentPath}/tagged-1`;
  const tagged2Path = `${parentPath}/tagged-2`;
  const untaggedPath = `${parentPath}/untagged`;

  const createdPages: CreatedPage[] = [];

  test.beforeAll(async ({ request }) => {
    // Children first, then the parent -- the parent's body references their
    // shared prefix, but nothing depends on create order here since $lsx
    // resolves its list at render time, not at page-creation time.
    createdPages.push(
      await createPage(request, {
        path: tagged1Path,
        body: 'tagged-1 page',
        pageTags: [tag],
      }),
    );
    createdPages.push(
      await createPage(request, {
        path: tagged2Path,
        body: 'tagged-2 page',
        pageTags: [tag],
      }),
    );
    createdPages.push(
      await createPage(request, {
        path: untaggedPath,
        body: 'untagged page', // no tag -> must NOT appear in the tag-filtered list
      }),
    );
    createdPages.push(
      await createPage(request, {
        path: parentPath,
        body: `$lsx(${parentPath}, tag=${tag}, num=1)`,
      }),
    );
  });

  test.afterAll(async ({ request }) => {
    await deletePagesCompletely(request, createdPages);
  });

  test('shows only tagged descendants, hierarchically, with a working count and Load more', async ({
    page,
  }) => {
    await page.goto(parentPath);

    const lsx = page.locator('.lsx');
    await expect(lsx).toBeVisible();

    // POSITIVE: exactly one tagged page is rendered initially (num=1 limits
    // the first fetch to 1 of the 2 matching pages).
    const taggedLinks = lsx.getByRole('link', { name: /^tagged-\d$/ });
    await expect(taggedLinks).toHaveCount(1);

    // NEGATIVE: the untagged sibling never appears among the rendered links.
    // Note: with num=1, this alone doesn't prove the tag condition is what's
    // filtering -- the untagged page could simply not have been fetched yet.
    // It's the count assertion right below (total includes/excludes the
    // untagged page) that actually discriminates a broken tag filter.
    await expect(lsx.getByRole('link', { name: 'untagged' })).toHaveCount(0);

    // Count display -- this is what proves the tag condition is applied:
    // with the tag filter working, only the 2 tagged pages match, so with 1
    // already shown the "Load more" button must report exactly 1 page left
    // (total - cursor). If the tag condition were dropped, the untagged
    // sibling would also match, making total 3 and this text "2 pages left".
    const loadMoreButton = lsx.locator('.btn-load-more');
    await expect(loadMoreButton).toBeVisible();
    await expect(loadMoreButton).toContainText('1 pages left');

    // Load more: clicking it fetches the remaining tagged page and the
    // button then disappears (0 pages left).
    await loadMoreButton.click();
    await expect(taggedLinks).toHaveCount(2);
    await expect(lsx.getByRole('link', { name: 'tagged-1' })).toBeVisible();
    await expect(lsx.getByRole('link', { name: 'tagged-2' })).toBeVisible();
    await expect(loadMoreButton).not.toBeVisible();

    // NEGATIVE (repeated after pagination): the untagged sibling still never
    // appears once every matching page has been loaded.
    await expect(lsx.getByRole('link', { name: 'untagged' })).toHaveCount(0);
  });
});
