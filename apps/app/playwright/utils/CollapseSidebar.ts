import { expect, type Page } from '@playwright/test';

export const collapseSidebar = async (
  page: Page,
  collapse: boolean,
): Promise<void> => {
  await expect(page.getByTestId('grw-sidebar')).toBeVisible();

  const isSidebarCollapsed = !(await page
    .locator('.grw-sidebar-dock')
    .isVisible());
  if (isSidebarCollapsed === collapse) {
    return;
  }

  const collapseSidebarToggle = page.getByTestId('btn-toggle-collapse');
  await expect(collapseSidebarToggle).toBeVisible();
  await collapseSidebarToggle.click();

  if (collapse) {
    await expect(page.locator('.grw-sidebar-dock')).not.toBeVisible();
  } else {
    await expect(page.locator('.grw-sidebar-dock')).toBeVisible();
  }
};
