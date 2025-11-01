import { expect, type Page, test } from '@playwright/test';

const openPageItemControl = async (page: Page): Promise<void> => {
  const nav = page.getByTestId('grw-contextual-sub-nav');
  const button = nav.getByTestId('open-page-item-control-btn');

  // Wait for navigation element to be visible and attached
  await expect(nav).toBeVisible();
  await nav.waitFor({ state: 'visible' });

  // Wait for button to be visible, enabled and attached
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.waitFor({ state: 'visible' });

  // Add a small delay to ensure the button is fully interactive
  await page.waitForTimeout(100);

  await button.click();
};

test('PageDeleteModal is shown successfully', async ({ page }) => {
  await page.goto('/Sandbox');

  await openPageItemControl(page);
  await page.getByTestId('open-page-delete-modal-btn').click();

  await expect(page.getByTestId('page-delete-modal')).toBeVisible();
});

test('PageDuplicateModal is shown successfully', async ({ page }) => {
  await page.goto('/Sandbox');

  await openPageItemControl(page);
  await page.getByTestId('open-page-duplicate-modal-btn').click();

  await expect(page.getByTestId('page-duplicate-modal')).toBeVisible();
});

test('PageMoveRenameModal is shown successfully', async ({ page }) => {
  await page.goto('/Sandbox');

  await openPageItemControl(page);
  await page.getByTestId('rename-page-btn').click();

  await expect(page.getByTestId('page-rename-modal')).toBeVisible();
});

// TODO: Uncomment after https://redmine.weseek.co.jp/issues/149786
// test('PresentationModal for "/" is shown successfully', async({ page }) => {
//   await page.goto('/');

//   await openPageItemControl(page);
//   await page.getByTestId('open-presentation-modal-btn').click();

//   expect(page.getByTestId('page-presentation-modal')).toBeVisible();
// });

test.describe('Page Accessories Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await openPageItemControl(page);
  });

  test('Page History is shown successfully', async ({ page }) => {
    await page
      .getByTestId('open-page-accessories-modal-btn-with-history-tab')
      .click();
    await expect(page.getByTestId('page-history')).toBeVisible();
  });

  test('Page Attachment Data is shown successfully', async ({ page }) => {
    await page
      .getByTestId('open-page-accessories-modal-btn-with-attachment-data-tab')
      .click();
    await expect(page.getByTestId('page-attachment')).toBeVisible();
  });

  test('Share Link Management is shown successfully', async ({ page }) => {
    await page
      .getByTestId(
        'open-page-accessories-modal-btn-with-share-link-management-data-tab',
      )
      .click();
    await expect(page.getByTestId('share-link-management')).toBeVisible();
  });
});

test('Successfully add new tag', async ({ page }) => {
  const tag = 'we';
  await page.goto('/Sandbox/Bootstrap5');

  await page.locator('#edit-tags-btn-wrapper-for-tooltip').click();
  await expect(page.locator('#edit-tag-modal')).toBeVisible();
  await page.locator('.rbt-input-main').fill(tag);
  await expect(
    page.locator('#tag-typeahead-asynctypeahead-item-0'),
  ).toBeVisible();
  await page.locator('#tag-typeahead-asynctypeahead-item-0').click();
  await page.getByTestId('tag-edit-done-btn').click();
  await expect(page.getByTestId('grw-tag-labels')).toContainText(tag);
});
