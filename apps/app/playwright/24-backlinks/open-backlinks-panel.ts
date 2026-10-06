import { expect, type Page } from '@playwright/test';

// Backlinks tab = page-item-control dropdown -> Backlinks entry -> PageAccessoriesModal.
export const openBacklinksPanel = async (page: Page): Promise<void> => {
  const nav = page.getByTestId('grw-contextual-sub-nav');
  await expect(nav).toBeVisible();

  const controlButton = nav.getByTestId('open-page-item-control-btn');
  await expect(controlButton).toBeVisible();
  await expect(controlButton).toBeEnabled();
  await controlButton.click();

  const tabButton = page.getByTestId(
    'open-page-accessories-modal-btn-with-backlinks-tab',
  );
  await expect(tabButton).toBeVisible();
  await tabButton.click();
};
