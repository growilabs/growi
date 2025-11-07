import { expect, test } from '@playwright/test';

test('admin is successfully loaded', async ({ page }) => {
  await page.goto('/admin');

  await expect(page.getByTestId('admin-home')).toBeVisible();
  await expect(
    page.getByTestId('admin-system-information-table'),
  ).toBeVisible();
});

test('admin/app is successfully loaded', async ({ page }) => {
  await page.goto('/admin/app');

  await expect(page.getByTestId('admin-app-settings')).toBeVisible();
  // await expect(page.getByTestId('v5-page-migration')).toBeVisible();
  await expect(page.locator('#cbFileUpload')).toBeChecked();
});

test('admin/security is successfully loaded', async ({ page }) => {
  await page.goto('/admin/security');

  await expect(page.getByTestId('admin-security')).toBeVisible();
  await expect(page.locator('#isShowRestrictedByOwner')).toHaveText(
    'Always displayed',
  );
  await expect(page.locator('#isShowRestrictedByGroup')).toHaveText(
    'Always displayed',
  );
});

test('admin/markdown is successfully loaded', async ({ page }) => {
  await page.goto('/admin/markdown');

  await expect(page.getByTestId('admin-markdown')).toBeVisible();
  await expect(page.locator('#isEnabledLinebreaksInComments')).toBeChecked();
});

test('admin/customize is successfully loaded', async ({ page }) => {
  await page.goto('/admin/customize');

  await expect(page.getByTestId('admin-customize')).toBeVisible();
});

test('admin/importer is successfully loaded', async ({ page }) => {
  await page.goto('/admin/importer');

  await expect(page.getByTestId('admin-import-data')).toBeVisible();
});

test('admin/export is successfully loaded', async ({ page }) => {
  await page.goto('/admin/export');

  await expect(page.getByTestId('admin-export-archive-data')).toBeVisible();
});

test('admin/data-transfer is successfully loaded', async ({ page }) => {
  await page.goto('/admin/data-transfer');

  await expect(page.getByTestId('admin-export-archive-data')).toBeVisible();
});

test('admin/notification is successfully loaded', async ({ page }) => {
  await page.goto('/admin/notification');

  await expect(page.getByTestId('admin-notification')).toBeVisible();
  // wait for retrieving slack integration status
  await expect(page.getByTestId('slack-integration-list-item')).toBeVisible();
});

test('admin/slack-integration is successfully loaded', async ({ page }) => {
  await page.goto('/admin/slack-integration');

  await expect(page.getByTestId('admin-slack-integration')).toBeVisible();
  await expect(page.locator('img.bot-difficulty-icon')).toHaveCount(3);
  await expect(page.locator('img.bot-difficulty-icon').first()).toBeVisible();
});

test('admin/slack-integration-legacy is successfully loaded', async ({
  page,
}) => {
  await page.goto('/admin/slack-integration-legacy');

  await expect(
    page.getByTestId('admin-slack-integration-legacy'),
  ).toBeVisible();
});

test('admin/users is successfully loaded', async ({ page }) => {
  await page.goto('/admin/users');

  await expect(page.getByTestId('admin-users')).toBeVisible();
  await expect(page.getByTestId('user-table-tr').first()).toBeVisible();
});

test('admin/user-groups is successfully loaded', async ({ page }) => {
  await page.goto('/admin/user-groups');

  await expect(page.getByTestId('admin-user-groups')).toBeVisible();
  await expect(page.getByTestId('grw-user-group-table').first()).toBeVisible();
});

test('admin/search is successfully loaded', async ({ page }) => {
  await page.goto('/admin/search');

  await expect(page.getByTestId('admin-full-text-search')).toBeVisible();

  // Only successful in the local environment.
  // wait for connected
  // await expect(page.getByTestId('connection-status-badge-connected')).toBeVisible();
});
