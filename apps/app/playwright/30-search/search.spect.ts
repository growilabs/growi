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
