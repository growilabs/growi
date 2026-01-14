import { expect, type Page, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

/**
 * Tests for Vim keymap functionality in the editor
 * @see https://github.com/growilabs/growi/issues/8814
 * @see https://github.com/growilabs/growi/issues/10701
 */

const changeKeymap = async (page: Page, keymap: string) => {
  // Open OptionsSelector
  await expect(page.getByTestId('options-selector')).toBeVisible();
  await page.getByTestId('options-selector').click();

  // Click keymap selection button to navigate to keymap selector
  await expect(page.getByTestId('keymap_current_selection')).toBeVisible();
  await page.getByTestId('keymap_current_selection').click();

  // Select Vim keymap
  await expect(page.getByTestId(`keymap_radio_item_${keymap}`)).toBeVisible();
  await page.getByTestId(`keymap_radio_item_${keymap}`).click();

  // Close OptionsSelector by clicking outside
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
};

const targetPagePath = '/Sandbox/vim-keymap-test-page';

test.describe('Vim keymap mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(targetPagePath);

    // Open Editor
    await expect(page.getByTestId('editor-button')).toBeVisible();
    await page.getByTestId('editor-button').click();
    await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  });

  test('Insert mode should persist while typing multiple characters', async ({
    page,
  }) => {
    const testText = 'Hello World';

    // Change to Vim keymap
    await changeKeymap(page, 'vim');

    // Enter insert mode
    await page.keyboard.type('i');

    // Append text
    await appendTextToEditorUntilContains(page, testText);

    // // Enter normal mode
    // await page.keyboard.press('Escape');

    // // Enter command mode
    // await page.keyboard.type(':')

    // // Command mode should be accessible
    // await expect(page.locator('.cm-vim-panel')).toBeVisible();

    // // Save page
    // await page.keyboard.type('w');

    // Change back to default keymap
    await changeKeymap(page, 'default');

    //
  });

  // test('Insert mode should persist after append command (a)', async ({
  //   page,
  // }) => {
  //   const editor = page.locator('.cm-content');
  //   const testText = 'Appended Text';

  //   // Focus the editor
  //   await editor.click();

  //   // Enter insert mode with 'a' (append) key
  //   await page.keyboard.press('a');

  //   // Type multiple characters - insert mode should persist
  //   await page.keyboard.type(testText, { delay: 50 });

  //   // Verify the text was typed correctly
  //   await expect(editor).toContainText(testText);
  // });

  // test('Insert mode should only exit when Escape is pressed', async ({
  //   page,
  // }) => {
  //   const editor = page.locator('.cm-content');
  //   const firstText = 'First';
  //   const secondText = 'Second';

  //   // Focus the editor
  //   await editor.click();

  //   // Enter insert mode and type
  //   await page.keyboard.press('i');
  //   await page.keyboard.type(firstText, { delay: 50 });

  //   // Press Escape to exit insert mode
  //   await page.keyboard.press('Escape');

  //   // Try to type more - should not insert text (in normal mode, 'd' would delete)
  //   // Instead, enter insert mode again and type
  //   await page.keyboard.press('A'); // Append at end of line
  //   await page.keyboard.type(secondText, { delay: 50 });

  //   // Verify both texts are present
  //   await expect(editor).toContainText(firstText);
  //   await expect(editor).toContainText(secondText);
  // });

  // test('Insert mode should persist during rapid typing', async ({ page }) => {
  //   const editor = page.locator('.cm-content');
  //   const testText = 'RapidTypingTest123';

  //   // Focus the editor
  //   await editor.click();

  //   // Enter insert mode
  //   await page.keyboard.press('i');

  //   // Type rapidly without delay
  //   await page.keyboard.type(testText);

  //   // Verify all characters were typed (insert mode didn't exit unexpectedly)
  //   await expect(editor).toContainText(testText);
  // });
});
