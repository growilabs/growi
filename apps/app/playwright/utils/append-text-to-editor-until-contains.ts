import { expect, type Page } from '@playwright/test';

export const appendTextToEditorUntilContains = async (
  page: Page,
  text: string,
) => {
  await page.locator('.cm-content').fill(text);
  await expect(page.getByTestId('page-editor-preview-body')).toContainText(
    text,
  );
};
