import { expect, type Page, test } from '@playwright/test';
import path from 'path';

const appendTextToEditorUntilContains = async (page: Page, text: string) => {
  await page.locator('.cm-content').fill(text);
  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    text,
  );
};

test('Successfully create page under specific path', async ({ page }) => {
  const newPagePath = '/child';
  const openPageCreateModalShortcutKey = 'c';

  await page.goto('/Sandbox');

  await page.keyboard.press(openPageCreateModalShortcutKey);
  await expect(page.getByTestId('page-create-modal')).toBeVisible();
  page
    .getByTestId('page-create-modal')
    .locator('.rbt-input-main')
    .fill(newPagePath);
  page.getByTestId('btn-create-page-under-below').click();
  await page.getByTestId('view-button').click();

  const createdPageId = path.basename(page.url());
  expect(createdPageId.length).toBe(24);
});

test('Successfully updating a page using a shortcut on a previously created page', async ({
  page,
}) => {
  const body1 = 'hello';
  const body2 = ' world!';
  const savePageShortcutKey = 'Control+s';

  await page.goto('/Sandbox/child');

  // 1st
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  await appendTextToEditorUntilContains(page, body1);
  await page.keyboard.press(savePageShortcutKey);
  await page.getByTestId('view-button').click();
  await expect(page.locator('.main')).toContainText(body1);

  // 2nd
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  await appendTextToEditorUntilContains(page, body1 + body2);
  await page.keyboard.press(savePageShortcutKey);
  await page.getByTestId('view-button').click();
  await expect(page.locator('.main')).toContainText(body1 + body2);
});
