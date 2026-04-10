import { expect, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

/**
 * Tests for Emacs keymap functionality in the editor.
 * Verifies that the registered EmacsHandler bindings produce the expected
 * markdown output in the editor source — i.e. the observable contract
 * (content changes) rather than internal implementation details.
 *
 * Keymap isolation strategy: page.route intercepts GET /_api/v3/personal-setting/editor-settings
 * and returns keymapMode:'emacs' without touching the database.  PUT requests are swallowed for
 * the same reason.  Because the route is scoped to the test's page instance, no other test file
 * is affected and no afterEach cleanup is required.
 *
 * @see packages/editor/src/client/services-internal/keymaps/emacs/
 * Requirements: 4.1, 5.2, 9.3
 */

const EDITOR_SETTINGS_ROUTE = '**/_api/v3/personal-setting/editor-settings';

test.describe
  .serial('Emacs keymap mode', () => {
    test.beforeEach(async ({ page }) => {
      // Return keymapMode:'emacs' for every settings fetch without writing to DB.
      // PUT requests (e.g. from UI interactions) are also swallowed so the DB stays clean.
      await page.route(EDITOR_SETTINGS_ROUTE, async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ keymapMode: 'emacs' }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}',
          });
        }
      });

      await page.goto('/Sandbox/emacs-keymap-test-page');

      // Open Editor
      await expect(page.getByTestId('editor-button')).toBeVisible();
      await page.getByTestId('editor-button').click();
      await expect(page.locator('.cm-content')).toBeVisible();
      await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
    });

    test('C-c C-s b should wrap text in bold markdown markers (Req 4.1)', async ({
      page,
    }) => {
      // Focus the editor
      await page.locator('.cm-content').click();

      // With no selection, C-c C-s b inserts ** markers and positions cursor between them
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+s');
      await page.keyboard.press('b');

      // Type text inside the inserted markers
      await page.keyboard.type('bold text');

      // Verify: bold markdown markers surround the typed text in the editor source
      await expect(page.locator('.cm-content')).toContainText('**bold text**');
    });

    test('C-c C-l should insert a markdown link template (Req 5.2)', async ({
      page,
    }) => {
      // Focus the editor
      await page.locator('.cm-content').click();

      // With no selection, C-c C-l inserts []() and positions cursor after [
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+l');

      // Type the link display text inside the brackets
      await page.keyboard.type('link text');

      // Verify: link template with typed display text appears in the editor source
      await expect(page.locator('.cm-content')).toContainText('[link text]()');
    });

    test('C-c C-n should navigate cursor to the next heading (Req 9.3)', async ({
      page,
    }) => {
      // Set up document with two headings so there is a "next" heading to navigate to
      await appendTextToEditorUntilContains(
        page,
        '# First Heading\n\n## Second Heading',
      );

      // Click on the first line to position cursor before "## Second Heading"
      await page.locator('.cm-line').first().click();

      // Navigate to the next heading with C-c C-n
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+n');

      // Cursor is now at the beginning of "## Second Heading".
      // Move to end of that line and append a unique marker to verify cursor position.
      await page.keyboard.press('End');
      await page.keyboard.type(' NAVIGATED');

      // Verify: the marker was appended at the second heading, not the first
      await expect(page.locator('.cm-content')).toContainText(
        '## Second Heading NAVIGATED',
      );
    });

    test('C-x C-s should save the page (Req 6.1)', async ({ page }) => {
      // Type content to ensure there is something to save
      await page.locator('.cm-content').click();
      await page.keyboard.type('Emacs save test');

      // Save with the Emacs two-stroke save binding
      await page.keyboard.press('Control+x');
      await page.keyboard.press('Control+s');

      // Expect a success toast notification confirming the page was saved
      await expect(page.locator('.Toastify__toast--success')).toBeVisible();
    });
  });
