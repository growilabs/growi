import { expect, type Page, test } from '@playwright/test';

const openPageAccessoriesModal = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByTestId('pageListButton').click();
  await expect(page.getByTestId('descendants-page-list-modal')).toBeVisible();
};

test('Page list modal is successfully opened', async ({ page }) => {
  await openPageAccessoriesModal(page);
  await expect(page.getByTestId('page-list-item-L').first()).not.toContainText(
    'You cannot see this page',
  );
});

test('Successfully open PageItemControl', async ({ page }) => {
  await openPageAccessoriesModal(page);
  await page
    .getByTestId('page-list-item-L')
    .first()
    .getByTestId('open-page-item-control-btn')
    .click();
  await expect(page.locator('.dropdown-menu.show')).toBeVisible();
});

test('Successfully close modal', async ({ page }) => {
  await openPageAccessoriesModal(page);
  await page.locator('.btn-close').click();
  await expect(
    page.getByTestId('descendants-page-list-modal'),
  ).not.toBeVisible();
});

test('Timeline list successfully openend', async ({ page }) => {
  await openPageAccessoriesModal(page);
  await page.getByTestId('timeline-tab-button').click();
  await expect(page.locator('.card-timeline').first()).toBeVisible();
});
