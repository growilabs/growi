import { expect, type Page, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/append-text-to-editor-until-contains';

/**
 * Tests for Vim keymap functionality in the editor
 * @see https://github.com/growilabs/growi/issues/8814
 * @see https://github.com/growilabs/growi/issues/10701
 */

const openKeymapSelector = async (page: Page) => {
  // Open OptionsSelector
  await expect(page.getByTestId('options-selector-btn')).toBeVisible();
  await page.getByTestId('options-selector-btn').click();
  await expect(page.getByTestId('options-selector-menu')).toBeVisible();

  // Click keymap selection button to navigate to keymap selector
  await expect(page.getByTestId('keymap_current_selection')).toBeVisible();
  await page.getByTestId('keymap_current_selection').click();
};

const closeOptionsSelector = async (page: Page) => {
  await page.getByTestId('options-selector-btn').click();
  await expect(page.getByTestId('options-selector-menu')).not.toBeVisible();
};

const changeKeymap = async (page: Page, keymap: string) => {
  await openKeymapSelector(page);

  const keymapRadioItem = page.getByTestId(`keymap_radio_item_${keymap}`);
  await expect(keymapRadioItem).toBeVisible();

  // Click the radio item and wait for the settings PUT to complete before
  // returning. useEditorSettings()'s `update()` (packages app stores/editor.tsx)
  // applies the change optimistically (client-side SWR mutate) and fires the
  // PUT in the background — OptionsSelector's onClick does not await it. The
  // next test in this serial block does a full page reload (beforeEach),
  // which re-fetches editor settings from the server via a fresh GET; if that
  // reload races ahead of this PUT, it reads back the stale pre-change value.
  // Waiting for the PUT response here closes that race for good, rather than
  // padding a timeout that only shrinks the window — see git history:
  // b36a517f already tried a blind timing fix on this exact test's `:w`
  // assertion and it did not hold (issues #11781/#11786).
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/_api/v3/personal-setting/editor-settings') &&
        res.request().method() === 'PUT' &&
        res.ok(),
    ),
    keymapRadioItem.click(),
  ]);

  // Confirm the UI reflects the new keymap before returning, so a click that
  // silently failed to register fails here instead of surfacing only in a
  // later test after a page reload.
  await expect(keymapRadioItem.locator('input')).toBeChecked();

  await closeOptionsSelector(page);
};

// Verifies the persisted keymap setting has actually been loaded and applied
// after a fresh page load (beforeEach navigates), independently of whether
// changeKeymap's own PUT succeeded. useEditorSettings() only fetches editor
// settings (and only then does the codemirror keymap extension mount) once
// per full page load; opening this same selector proves that fetch already
// resolved before the caller starts sending Vim keystrokes.
const expectCurrentKeymapToBe = async (page: Page, keymap: string) => {
  await openKeymapSelector(page);
  await expect(
    page.getByTestId(`keymap_radio_item_${keymap}`).locator('input'),
  ).toBeChecked();
  await closeOptionsSelector(page);
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
      // Confirm the Vim keymap set by the previous test has actually loaded
      // on this fresh page load before sending any Vim keystrokes — see
      // expectCurrentKeymapToBe for why this can't be taken for granted.
      await expectCurrentKeymapToBe(page, 'vim');

      // Focus the editor and ensure Normal mode — beforeEach re-navigates, so
      // the editor may not have focus yet and CodeMirror's Vim extension may
      // need a keystroke to settle into Normal mode on webkit.
      await page.locator('.cm-content').click();
      await page.keyboard.press('Escape');

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
