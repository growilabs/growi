import { expect, test } from '@playwright/test';

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

  // open the editor
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();

  // fill the editor with slide content
  await page
    .locator('.cm-content')
    .fill('---\nslide: true\n---\n# Slide 1\n---\n# Slide 2');

  // The editor preview must finish rendering both slides through the marpit
  // pipeline before saving — this is the slide-mode observable contract and
  // also proves the preview did not crash on slide content.
  const previewSlides = page
    .getByTestId('page-editor-preview-body')
    .locator('svg[data-marpit-svg]');
  await expect(previewSlides).toHaveCount(2);

  // save
  await page.keyboard.press('Control+s');

  // view mode must render the slide deck after save
  await page.getByTestId('view-button').click();
  await expect(page.locator('.slides')).toBeVisible();

  // reload exercises the SWR loading path where rendererOptions is briefly
  // undefined; the slide page must still render without crashing.
  await page.reload();
  await expect(page.locator('.slides')).toBeVisible();
});
