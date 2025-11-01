import { expect, type Page, test } from '@playwright/test';

const appendTextToEditorUntilContains = async (page: Page, text: string) => {
  await page.locator('.cm-content').fill(text);
  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    text,
  );
};

test('has title', async ({ page }) => {
  await page.goto('/Sandbox');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Sandbox/);
});

test('get h1', async ({ page }) => {
  await page.goto('/Sandbox');

  // Expects page to have a heading with the name of Installation.
  await expect(
    page.getByRole('heading').filter({ hasText: /\/Sandbox/ }),
  ).toBeVisible();
});

test('/Sandbox/Math is successfully loaded', async ({ page }) => {
  await page.goto('/Sandbox/Math');

  // Expect the Math-specific elements to be present
  await expect(page.locator('.katex').first()).toBeVisible();
});

test('Sandbox with edit is successfully loaded', async ({ page }) => {
  await page.goto('/Sandbox#edit');

  // Expect the Editor-specific elements to be present
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  await expect(page.getByTestId('save-page-btn')).toBeVisible();
  await expect(page.getByTestId('grw-grant-selector')).toBeVisible();
});

test.describe
  .serial('PageEditor', () => {
    const body1 = 'hello';
    const body2 = ' world!';
    const targetPath = '/Sandbox/testForUseEditingMarkdown';

    test('Edit and save with save-page-btn', async ({ page }) => {
      await page.goto(targetPath);

      await page.getByTestId('editor-button').click();
      await appendTextToEditorUntilContains(page, body1);
      await page.getByTestId('save-page-btn').click();

      await expect(page.locator('.wiki').first()).toContainText(body1);
    });

    test('Edit and save with shortcut key', async ({ page }) => {
      const savePageShortcutKey = 'Control+s';

      await page.goto(targetPath);

      await page.getByTestId('editor-button').click();

      await expect(page.locator('.cm-content')).toContainText(body1);
      await expect(page.getByTestId('page-editor-preview-body')).toContainText(
        body1,
      );

      await appendTextToEditorUntilContains(page, body1 + body2);
      await page.keyboard.press(savePageShortcutKey);
      await page.getByTestId('view-button').click();

      await expect(page.locator('.wiki').first()).toContainText(body1 + body2);
    });
  });

test('Access to /me page', async ({ page }) => {
  await page.goto('/me');

  // Expect the UserSettgins-specific elements to be present when accessing /me (UserSettgins)
  await expect(page.getByTestId('grw-user-settings')).toBeVisible();
});

test('All In-App Notification list is successfully loaded', async ({
  page,
}) => {
  await page.goto('/me/all-in-app-notifications');

  // Expect the In-App Notification-specific elements to be present when accessing /me/all-in-app-notifications
  await expect(page.getByTestId('grw-in-app-notification-page')).toBeVisible();
});

test('/trash is successfully loaded', async ({ page }) => {
  await page.goto('/trash');

  await expect(page.getByTestId('trash-page-list')).toContainText(
    'There are no pages under this page.',
  );
});

test('/tags is successfully loaded', async ({ page }) => {
  await page.goto('/tags');

  await expect(page.getByTestId('grw-tags-list')).toContainText(
    'You have no tag, You can set tags on pages',
  );
});

test.describe
  .serial('Access to Template Editing Mode', () => {
    const templateBody1 = 'Template for children';
    const templateBody2 = 'Template for descendants';

    test('Successfully created template for children', async ({ page }) => {
      await page.goto('/Sandbox');

      await expect(page.getByTestId('grw-contextual-sub-nav')).toBeVisible();
      await page
        .getByTestId('grw-contextual-sub-nav')
        .getByTestId('open-page-item-control-btn')
        .click();
      await page.getByTestId('open-page-template-modal-btn').click();
      expect(page.getByTestId('page-template-modal')).toBeVisible();

      await page.getByTestId('template-button-children').click();

      await appendTextToEditorUntilContains(page, templateBody1);
      await page.getByTestId('save-page-btn').click();

      await expect(page.locator('.wiki').first()).toContainText(templateBody1);
    });

    test('Template is applied to pages created (template for children)', async ({
      page,
    }) => {
      await page.goto('/Sandbox');

      await page.getByTestId('grw-page-create-button').click();

      await expect(page.locator('.cm-content')).toContainText(templateBody1);
      await expect(page.getByTestId('page-editor-preview-body')).toContainText(
        templateBody1,
      );
    });

    test('Successfully created template for descendants', async ({ page }) => {
      await page.goto('/Sandbox');

      await expect(page.getByTestId('grw-contextual-sub-nav')).toBeVisible();
      await page
        .getByTestId('grw-contextual-sub-nav')
        .getByTestId('open-page-item-control-btn')
        .click();
      await page.getByTestId('open-page-template-modal-btn').click();
      expect(page.getByTestId('page-template-modal')).toBeVisible();

      await page.getByTestId('template-button-descendants').click();

      await appendTextToEditorUntilContains(page, templateBody2);
      await page.getByTestId('save-page-btn').click();

      await expect(page.locator('.wiki').first()).toContainText(templateBody2);
    });

    test('Template is applied to pages created (template for descendants)', async ({
      page,
    }) => {
      await page.goto('/Sandbox/Bootstrap5');

      await page.getByTestId('grw-page-create-button').click();

      await expect(page.locator('.cm-content')).toContainText(templateBody2);
      await expect(page.getByTestId('page-editor-preview-body')).toContainText(
        templateBody2,
      );
    });
  });
