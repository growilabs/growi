import { expect, type Page, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

/**
 * Tests for Vim keymap functionality in the editor
 * @see https://github.com/growilabs/growi/issues/8814
 * @see https://github.com/growilabs/growi/issues/10701
 */

const changeKeymap = async (page: Page, keymap: string) => {
  // Open OptionsSelector
  await expect(page.getByTestId('options-selector-btn')).toBeVisible();
  await page.getByTestId('options-selector-btn').click();
  await expect(page.getByTestId('options-selector-menu')).toBeVisible();

  // Click keymap selection button to navigate to keymap selector
  await expect(page.getByTestId('keymap_current_selection')).toBeVisible();
  await page.getByTestId('keymap_current_selection').click();

  // Select Vim keymap
  await expect(page.getByTestId(`keymap_radio_item_${keymap}`)).toBeVisible();
  await page.getByTestId(`keymap_radio_item_${keymap}`).click();

  // Close OptionsSelector
  await page.getByTestId('options-selector-btn').click();
  await expect(page.getByTestId('options-selector-menu')).not.toBeVisible();
};

test.describe
  .serial('Vim keymap mode', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/Sandbox/vim-keymap-test-page');

      // Open Editor
      await expect(page.getByTestId('editor-button')).toBeVisible();
      await page.getByTestId('editor-button').click();
      await expect(page.locator('.cm-content')).toBeVisible();
      await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
    });

    test('Insert mode should persist while typing multiple characters', async ({
      page,
    }) => {
      const testText = 'Hello World';

      // Change to Vim keymap
      await changeKeymap(page, 'vim');

      // Focus the editor
      await page.locator('.cm-content').click();

      // Enter insert mode
      await page.keyboard.type('i');

      // Append text
      await appendTextToEditorUntilContains(page, testText);
    });

    test('Write command (:w) should save the page successfully', async ({
      page,
    }) => {
      // Enter command mode
      await page.keyboard.type(':');
      await expect(page.locator('.cm-vim-panel')).toBeVisible();

      // Type write command and execute
      await page.keyboard.type('w');
      await page.keyboard.press('Enter');

      // Expect a success toaster to be displayed
      await expect(page.locator('.Toastify__toast--success')).toBeVisible();

      // Restore keymap to default
      await changeKeymap(page, 'default');
    });
  });
