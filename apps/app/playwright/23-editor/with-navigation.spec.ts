import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * for the issues:
 * @see https://redmine.weseek.co.jp/issues/122040
 * @see https://redmine.weseek.co.jp/issues/124281
 */
test('should not be cleared and should prevent GrantSelector from modified', async ({
  page,
}) => {
  await page.goto('/Sandbox/for-122040');

  // Open Editor
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // Open GrantSelector and select "only me"
  await page.getByTestId('grw-grant-selector').click();
  const dropdownMenu = page.getByTestId('grw-grant-selector-dropdown-menu');
  await expect(dropdownMenu).toBeVisible();
  await dropdownMenu.locator('.dropdown-item').nth(2).click();
  await expect(page.getByTestId('grw-grant-selector')).toContainText('Only me');

  // Upload attachment
  const filePath = path.resolve(__dirname, '../23-editor/assets/example.txt');
  const buffer = readFileSync(filePath).toString('base64');
  const dataTransfer = await page.evaluateHandle(
    async ({ bufferData, localFileName, localFileType }) => {
      const dt = new DataTransfer();

      const blobData = await fetch(bufferData).then((res) => res.blob());

      const file = new File([blobData], localFileName, {
        type: localFileType,
      });
      dt.items.add(file);
      return dt;
    },
    {
      bufferData: `data:application/octet-stream;base64,${buffer}`,
      localFileName: 'sample.tst',
      localFileType: 'application/octet-stream',
    },
  );
  await page
    .locator('.dropzone')
    .first()
    .dispatchEvent('drop', { dataTransfer });
  await expect(
    page.getByTestId('page-editor-preview-body').getByTestId('rich-attachment'),
  ).toBeVisible();

  // Save page
  await page.getByTestId('save-page-btn').click();

  // Expect grant not to be reset after uploading an attachment
  await expect(page.getByTestId('page-grant-alert')).toContainText(
    'Browsing of this page is restricted',
  );
});

const appendTextToEditorUntilContains = async (page: Page, text: string) => {
  await page.locator('.cm-content').fill(text);
  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    text,
  );
};

/**
 * for the issue:
 * @see https://redmine.weseek.co.jp/issues/115285
 */
test('Successfully updating the page body', async ({ page }) => {
  const page1Path = '/Sandbox/for-115285/page1';
  const page2Path = '/Sandbox/for-115285/page2';

  const page1Body = 'Hello';
  const page2Body = 'World';

  await page.goto(page1Path);

  // Open Editor (page1)
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // Append text
  await appendTextToEditorUntilContains(page, page1Body);

  // Save page
  await page.getByTestId('save-page-btn').click();

  await expect(page.locator('.main')).toContainText(page1Body);

  // Duplicate page1
  await page
    .getByTestId('grw-contextual-sub-nav')
    .getByTestId('open-page-item-control-btn')
    .click();
  await page.getByTestId('open-page-duplicate-modal-btn').click();
  await expect(page.getByTestId('page-duplicate-modal')).toBeVisible();
  await page.locator('.form-control').fill(page2Path);
  await page.getByTestId('btn-duplicate').click();

  // Open Editor (page2)
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // Expect to see the text from which you are duplicating
  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    page1Body,
  );

  // Append text
  await appendTextToEditorUntilContains(page, page1Body + page2Body);

  await page.goto(page1Path);

  // Open Editor (page1)
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    page1Body,
  );
});
