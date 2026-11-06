import { expect, test } from '@playwright/test';

import { FILTER_TEST_USER_A } from '../utils/test-users';

// Covers the UI <-> `?q=` <-> chip wiring that search-filters.spec.ts skips (it
// asserts operator matching via raw `?q=` URLs). Asserting the round-trip rather
// than which pages match keeps this suite off the index-rebuild path: it needs no
// page fixtures — the author typeahead only needs the user to exist, and
// FILTER_TEST_USER_A is provisioned by users.setup.ts.

const AUTHOR = FILTER_TEST_USER_A.username;
const TAG = 'e2e-uifilter-tag';

// URL is URLSearchParams-encoded (`:` -> `%3A`), so tolerate either form.
const authorInUrl = /author(?:%3A|:)e2e-filter-author-a/;
const tagInUrl = /tag(?:%3A|:)e2e-uifilter-tag/;

test.describe('search filter UI', () => {
  test('builds an author filter from the panel and reflects it in the URL and chips', async ({
    page,
  }) => {
    await page.goto('/_search?q=sandbox');
    await expect(page.getByTestId('search-result-base')).toBeVisible();

    // Toggle accessible name is "tune Filters" (icon ligature + label).
    await page.getByRole('button', { name: /Filters/ }).click();

    // pressSequentially fires the per-character input events the debounced
    // AsyncTypeahead listens to; fill() can outrun the debounce on CI.
    const authorInput = page.getByPlaceholder('Filter by author');
    await authorInput.pressSequentially(AUTHOR);
    const option = page.getByRole('option', { name: AUTHOR, exact: true });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    await expect(
      page.getByRole('button', { name: `Remove Author: ${AUTHOR}` }),
    ).toBeVisible();
    await expect(page).toHaveURL(authorInUrl);
    // The free-text keyword is preserved alongside the filter, not clobbered.
    await expect(page).toHaveURL(/q=[^&]*sandbox/);
  });

  test('hydrates chips from a URL with inline operators', async ({ page }) => {
    await page.goto(`/_search?q=author:${AUTHOR} tag:${TAG}`);
    await expect(page.getByTestId('search-result-base')).toBeVisible();

    // Chips hydrate from the parsed URL, independently of the deferred filter
    // panel (unmounted until the toggle is first clicked).
    await expect(
      page.getByRole('button', { name: `Remove Author: ${AUTHOR}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Remove Tag: ${TAG}` }),
    ).toBeVisible();
  });

  test('removing one chip drops only its operator from the URL', async ({
    page,
  }) => {
    await page.goto(`/_search?q=author:${AUTHOR} tag:${TAG}`);
    await expect(page.getByTestId('search-result-base')).toBeVisible();

    const authorChipRemove = page.getByRole('button', {
      name: `Remove Author: ${AUTHOR}`,
    });
    const tagChipRemove = page.getByRole('button', {
      name: `Remove Tag: ${TAG}`,
    });
    await expect(authorChipRemove).toBeVisible();
    await expect(tagChipRemove).toBeVisible();

    await authorChipRemove.click();

    await expect(authorChipRemove).toHaveCount(0);
    await expect(tagChipRemove).toBeVisible();
    await expect(page).not.toHaveURL(authorInUrl);
    await expect(page).toHaveURL(tagInUrl);
  });

  test('"Clear all" removes every chip and clears the operators from the URL', async ({
    page,
  }) => {
    await page.goto(`/_search?q=author:${AUTHOR} tag:${TAG}`);
    await expect(page.getByTestId('search-result-base')).toBeVisible();

    const chipStrip = page.getByRole('group', { name: 'Filters' });
    await expect(chipStrip).toBeVisible();

    await page.getByRole('button', { name: 'Clear all' }).click();

    await expect(chipStrip).toHaveCount(0);
    await expect(page).not.toHaveURL(authorInUrl);
    await expect(page).not.toHaveURL(tagInUrl);
  });
});
