import { expect, test } from '@playwright/test';

test('Search page with "q" param is successfully loaded', async ({ page }) => {
  // Navigate to the search page with query parameters
  await page.goto('/_search?q=alerts');

  // Confirm search result elements are visible
  await expect(page.getByTestId('search-result-base')).toBeVisible();
  await expect(page.getByTestId('search-result-list')).toBeVisible();
  await expect(page.getByTestId('search-result-content')).toBeVisible();
  await expect(page.locator('.wiki')).toBeVisible();
});

test('checkboxes behaviors', async ({ page }) => {
  // Navigate to the search page with query parameters
  await page.goto('/_search?q=alerts');

  // Confirm search result elements are visible
  await expect(page.getByTestId('search-result-base')).toBeVisible();
  await expect(page.getByTestId('search-result-list')).toBeVisible();
  await expect(page.getByTestId('search-result-content')).toBeVisible();
  await expect(page.locator('.wiki')).toBeVisible();

  // Click the first checkbox
  await page.getByTestId('cb-select').first().click({ force: true });

  // Unclick the first checkbox
  await page.getByTestId('cb-select').first().click({ force: true });

  // Click the select all checkbox
  await page
    .getByTestId('delete-control-button')
    .first()
    .click({ force: true });
  await page.getByTestId('cb-select-all').click({ force: true });

  // Unclick the first checkbox after selecting all
  await page.getByTestId('cb-select').first().click({ force: true });

  // Click the first checkbox again
  await page.getByTestId('cb-select').first().click({ force: true });

  // Unclick the select all checkbox
  await page.getByTestId('cb-select').first().click({ force: true });
});

test('successfully loads /_private-legacy-pages', async ({ page }) => {
  await page.goto('/_private-legacy-pages');

  // Confirm search result elements are visible
  await expect(
    page.locator('[data-testid="search-result-base"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="search-result-private-legacy-pages"]'),
  ).toBeVisible();
});

test('Search all pages by word', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-search-modal-button').click();
  await expect(page.getByTestId('search-modal')).toBeVisible();
  await page.locator('.form-control').fill('sand');
  await expect(page.locator('.search-menu-item').first()).toBeVisible();
});

test.describe
  .serial('Search all pages', () => {
    const tag = 'help';
    const searchText = `tag:${tag}`;

    test('Successfully created tags', async ({ page }) => {
      await page.goto('/');

      // open Edit Tags Modal to add tag
      await page.locator('.grw-side-contents-sticky-container').isVisible();
      await page.locator('#edit-tags-btn-wrapper-for-tooltip').click();
      await expect(page.locator('#edit-tag-modal')).toBeVisible();
      await page.locator('.rbt-input-main').fill(tag);
      await page.locator('#tag-typeahead-asynctypeahead-item-0').click();
      await page.getByTestId('tag-edit-done-btn').click();
    });

    test('Search all pages by tag is successfully loaded', async ({ page }) => {
      await page.goto('/');

      // Search
      await page.getByTestId('open-search-modal-button').click();
      await expect(page.getByTestId('search-modal')).toBeVisible();
      await page.locator('.form-control').fill(searchText);
      await page.getByTestId('search-all-menu-item').click();

      // Confirm search result elements are visible
      const searchResultList = page.getByTestId('search-result-list');
      await expect(searchResultList).toBeVisible();
      await expect(searchResultList.locator('li')).toHaveCount(1);
    });

    test('Successfully order page search results by tag', async ({ page }) => {
      await page.goto('/');

      await page.locator('.grw-tag-simple-bar').locator('a').click();

      expect(page.getByTestId('search-result-base')).toBeVisible();
      expect(page.getByTestId('search-result-list')).toBeVisible();
      expect(page.getByTestId('search-result-content')).toBeVisible();
    });
  });

test.describe('Sort with dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/_search?q=sand');

    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();

    // open sort dropdown
    await page.locator('.search-control').locator('button').first().click();
  });

  test('Open sort dropdown', async ({ page }) => {
    await expect(
      page.locator('.search-control .dropdown-menu.show'),
    ).toBeVisible();
  });

  test('Sort by relevance', async ({ page }) => {
    const dropdownMenu = page.locator('.search-control .dropdown-menu.show');

    await expect(dropdownMenu).toBeVisible();
    await dropdownMenu.locator('.dropdown-item').nth(0).click();

    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();
  });

  test('Sort by creation date', async ({ page }) => {
    const dropdownMenu = page.locator('.search-control .dropdown-menu.show');

    await expect(dropdownMenu).toBeVisible();
    await dropdownMenu.locator('.dropdown-item').nth(1).click();

    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();
  });

  test('Sort by last update date', async ({ page }) => {
    const dropdownMenu = page.locator('.search-control .dropdown-menu.show');

    await expect(dropdownMenu).toBeVisible();
    await dropdownMenu.locator('.dropdown-item').nth(2).click();

    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();
  });
});

test.describe('Search and use', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/_search?q=alerts');

    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();

    await page
      .getByTestId('page-list-item-L')
      .first()
      .getByTestId('open-page-item-control-btn')
      .click();
    await expect(page.locator('.dropdown-menu.show')).toBeVisible();
  });

  test('Successfully the dropdown is opened', async ({ page }) => {
    await expect(page.locator('.dropdown-menu.show')).toBeVisible();
  });

  test('Successfully add bookmark', async ({ page }) => {
    const dropdonwMenu = page.locator('.dropdown-menu.show');

    await expect(dropdonwMenu).toBeVisible();

    // Add bookmark
    await dropdonwMenu.getByTestId('add-bookmark-btn').click();

    await expect(
      page
        .getByTestId('search-result-content')
        .locator('.btn-bookmark.active')
        .first(),
    ).toBeVisible();
  });

  test('Successfully open duplicate modal', async ({ page }) => {
    const dropdonwMenu = page.locator('.dropdown-menu.show');

    await expect(dropdonwMenu).toBeVisible();

    await dropdonwMenu.getByTestId('open-page-duplicate-modal-btn').click();

    await expect(page.getByTestId('page-duplicate-modal')).toBeVisible();
  });

  test('Successfully open move/rename modal', async ({ page }) => {
    const dropdonwMenu = page.locator('.dropdown-menu.show');

    await expect(dropdonwMenu).toBeVisible();

    await dropdonwMenu.getByTestId('rename-page-btn').click();

    await expect(page.getByTestId('page-rename-modal')).toBeVisible();
  });

  test('Successfully open delete modal', async ({ page }) => {
    const dropdonwMenu = page.locator('.dropdown-menu.show');

    await expect(dropdonwMenu).toBeVisible();

    await dropdonwMenu.getByTestId('open-page-delete-modal-btn').click();

    await expect(page.getByTestId('page-delete-modal')).toBeVisible();
  });
});

test('Search current tree by word is successfully loaded', async ({ page }) => {
  await page.goto('/');
  const searchText = 'GROWI';

  await page.getByTestId('open-search-modal-button').click();
  await expect(page.getByTestId('search-modal')).toBeVisible();
  await page.locator('.form-control').fill(searchText);
  await page.getByTestId('search-prefix-menu-item').click();

  await expect(page.getByTestId('search-result-base')).toBeVisible();
  await expect(page.getByTestId('search-result-list')).toBeVisible();
  await expect(page.getByTestId('search-result-content')).toBeVisible();
});

test.describe('Search result navigation and repeated search', () => {
  test('Repeated search works', async ({ page }) => {
    // Step 1: Start from the home page and reload to clear any state
    await page.goto('/');
    await page.reload();

    // Step 2: Open search modal and search for "sandbox"
    await page.getByTestId('open-search-modal-button').click();
    await expect(page.getByTestId('search-modal')).toBeVisible();
    await page.locator('.form-control').fill('sandbox');

    // Step 3: Submit the search by clicking on "search in all" menu item
    await expect(page.getByTestId('search-all-menu-item')).toBeVisible();
    await page.getByTestId('search-all-menu-item').click();

    // Step 4: Verify that the search page is displayed with results
    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();
    await expect(page).toHaveURL(/\/_search\?q=sandbox/);

    // Step 5: Click on the first search result to navigate to a page
    const sandboxPageLink = page
      .getByTestId('search-result-list')
      .getByRole('link', { name: 'Sandbox' })
      .first();
    await sandboxPageLink.click();
    await expect(page).toHaveTitle(/Sandbox/);

    // Step 6: Wait for leaving search results and verify page content is displayed
    await expect(page.getByTestId('search-result-base')).not.toBeVisible();
    // Verify page body is rendered (not empty due to stale atom data)
    await expect(page.locator('.wiki')).toBeVisible();
    await expect(page.locator('.wiki')).not.toBeEmpty();

    // Step 7: From the navigated page, open search modal again
    await page.getByTestId('open-search-modal-button').click();
    await expect(page.getByTestId('search-modal')).toBeVisible();

    // Step 8: Search for the same keyword ("sandbox")
    await page.locator('.form-control').fill('sandbox');

    // Step 9: Submit the search by clicking on "search in all" menu item
    await expect(page.getByTestId('search-all-menu-item')).toBeVisible();
    await page.getByTestId('search-all-menu-item').click();

    // Step 10: Verify that the search page is displayed with results
    await expect(page.getByTestId('search-result-base')).toBeVisible();
    await expect(page.getByTestId('search-result-list')).toBeVisible();
    await expect(page.getByTestId('search-result-content')).toBeVisible();
    await expect(page).toHaveURL(/\/_search\?q=sandbox/);

    // Step 11: Click on the second search result to navigate to a page
    const mathPageLink = page
      .getByTestId('search-result-list')
      .getByRole('link', { name: 'Math' })
      .first();
    await mathPageLink.click();
    // and verify the page that is not Sandbox is loaded
    await expect(page).not.toHaveTitle(/Sandbox/);

    // Step 12: Verify page body is rendered (not empty due to stale atom data)
    await expect(page.locator('.wiki')).toBeVisible();
    await expect(page.locator('.wiki')).not.toBeEmpty();
  });
});
