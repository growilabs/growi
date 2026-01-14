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

test.describe('Vim keymap mode', () => {
  test('Insert mode should persist while typing multiple characters', async ({
    page,
  }) => {
    const testText = 'Hello World';
    const testPagePath = '/Sandbox/vim-keymap-test-page';

    await page.goto(testPagePath);

    // Open Editor
    await expect(page.getByTestId('editor-button')).toBeVisible();
    await page.getByTestId('editor-button').click();
    await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

    // Change to Vim keymap
    await changeKeymap(page, 'vim');

    // Focus the editor
    await page.locator('.cm-content').click();

    // Enter insert mode
    await page.keyboard.type('i');

    // Append text
    await appendTextToEditorUntilContains(page, testText);

    // Change back to default keymap
    await changeKeymap(page, 'default');
  });
});
