import { expect, type Page } from '@playwright/test';

export const collapseSidebar = async (
  page: Page,
  isCollapsed: boolean,
): Promise<void> => {
  const isSidebarContentsHidden = !(await page
    .getByTestId('grw-sidebar-contents')
    .isVisible());
  if (isSidebarContentsHidden === isCollapsed) {
    return;
  }

  const collapseSidebarToggle = page.getByTestId('btn-toggle-collapse');
  await expect(collapseSidebarToggle).toBeVisible();
  await collapseSidebarToggle.click();

  if (isCollapsed) {
    await expect(page.locator('.grw-sidebar-dock')).not.toBeVisible();
  } else {
    await expect(page.locator('.grw-sidebar-dock')).toBeVisible();
  }
};
