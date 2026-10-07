import { expect, test } from '@playwright/test';

import { collapseSidebar } from '../utils';

test('/Sandbox is successfully loaded', async ({ page }) => {
  await page.goto('/Sandbox');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Sandbox/);
});

test('/Sandbox/math is successfully loaded', async ({ page }) => {
  await page.goto('/Sandbox/Math');

  // Check if the math elements are visible
  await expect(page.locator('.katex').first()).toBeVisible();
});

test('Access to /me page', async ({ page }) => {
  await page.goto('/me');

  // Expect to be redirected to /login when accessing /me
  await expect(page.getByTestId('login-form')).toBeVisible();
});

test('Access to /trash page', async ({ page }) => {
  await page.goto('/trash');

  // Expect the trash page specific elements to be present when accessing /trash
  await expect(page.getByTestId('trash-page-list')).toBeVisible();
});

test('Access to /tags page', async ({ page }) => {
  await page.goto('/');

  await collapseSidebar(page, false);
  await page.getByTestId('grw-sidebar-nav-primary-tags').click();
  await expect(page.getByTestId('grw-sidebar-content-tags')).toBeVisible();
  await expect(page.getByTestId('grw-tags-list').first()).toBeVisible();
  await expect(page.getByTestId('grw-tags-list').first()).toContainText(
    'You have no tag, You can set tags on pages',
  );

  await page.getByTestId('check-all-tags-button').click();
  await expect(page.getByTestId('tags-page')).toBeVisible();
});
