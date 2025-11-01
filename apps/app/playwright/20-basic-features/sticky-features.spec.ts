import { expect, test } from '@playwright/test';

test.describe('Sticky features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Subnavigation displays changes on scroll down and up', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.sticky-outer-wrapper').first()).not.toHaveClass(
      /active/,
    );
  });

  test('Subnavigation is not displayed when move to other pages', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Move to /Sandbox page
    await page.goto('/Sandbox');
    await expect(page.locator('.sticky-outer-wrapper').first()).not.toHaveClass(
      /active/,
    );
  });

  test('Able to click buttons on subnavigation switcher when sticky', async ({
    page,
  }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 250));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Click editor button
    await page.getByTestId('editor-button').click();
    await expect(page.locator('.layout-root')).toHaveClass(/editing/);
  });

  test('Subnavigation is sticky when on small window', async ({ page }) => {
    // Scroll down to trigger sticky effect
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(page.locator('.sticky-outer-wrapper').first()).toHaveClass(
      /active/,
    );

    // Set viewport to small size
    await page.setViewportSize({ width: 600, height: 1024 });
    await expect(
      page
        .getByTestId('grw-contextual-sub-nav')
        .getByTestId('grw-page-editor-mode-manager'),
    ).toBeVisible();
  });
});
