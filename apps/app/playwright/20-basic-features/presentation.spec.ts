import { expect, test } from '@playwright/test';

import { appendTextToEditorUntilContains } from '../utils/AppendTextToEditorUntilContains';

test('Presentation', async ({ page }) => {
  await page.goto('/');

  // show presentation modal
  await page
    .getByTestId('grw-contextual-sub-nav')
    .getByTestId('open-page-item-control-btn')
    .click();
  await page.getByTestId('open-presentation-modal-btn').click();

  // check the content of the h1
  await expect(
    page.getByRole('application').getByRole('heading', { level: 1 }),
  ).toHaveText(/Welcome to GROWI/);
});

test('Slide page (slide: true frontmatter) renders without crashing', async ({
  page,
}) => {
  await page.goto('/Sandbox/slide-test');

  // create slide content
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  await appendTextToEditorUntilContains(
    page,
    '---\nslide: true\n---\n# Slide 1\n---\n# Slide 2',
  );
  await page.keyboard.press('Control+s');

  // verify slide view renders
  await page.getByTestId('view-button').click();
  await expect(page.locator('.slides')).toBeVisible();

  // reload to verify SWR loading path does not crash
  await page.reload();
  await expect(page.locator('.slides')).toBeVisible();
});
