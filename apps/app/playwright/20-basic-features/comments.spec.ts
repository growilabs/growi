import { expect, test } from '@playwright/test';

test.describe('Comment', () => {
  // make tests run in serial
  test.describe.configure({ mode: 'serial' });

  test('Create comment page', async ({ page }) => {
    await page.goto('/comment');
    await page.getByTestId('editor-button').click();
    await page.getByTestId('save-page-btn').click();
    await expect(page.locator('.page-meta')).toBeVisible();
  });

  test('Successfully add comments', async ({ page }) => {
    const commentText = 'add comment';
    await page.goto('/comment');

    // Add comment
    await page.getByTestId('page-comment-button').click();
    await page.getByTestId('open-comment-editor-button').click();
    await page.locator('.cm-content').fill(commentText);
    await page.getByTestId('comment-submit-button').first().click();

    await expect(page.locator('.page-comment-body')).toHaveText(commentText);
    await expect(
      page.getByTestId('page-comment-button').locator('.grw-count-badge'),
    ).toHaveText('1');
  });

  test('Successfully reply comments', async ({ page }) => {
    const commentText = 'reply comment';
    await page.goto('/comment');

    // Reply comment
    await page.getByTestId('comment-reply-button').click();
    await page.locator('.cm-content').fill(commentText);
    await page.getByTestId('comment-submit-button').first().click();

    await expect(page.locator('.page-comment-body').nth(1)).toHaveText(
      commentText,
    );
    await expect(
      page.getByTestId('page-comment-button').locator('.grw-count-badge'),
    ).toHaveText('2');
  });

  test('Successfully edit comments', async ({ page }) => {
    const editedText = 'edited comment';
    await page.goto('/comment');

    const firstComment = page.locator('.page-comment').first();
    await firstComment.hover();
    await firstComment.getByTestId('comment-edit-button').click();

    const editor = page.locator('.cm-content').first();
    await expect(editor).toBeVisible();
    await editor.fill(editedText);
    await page.getByTestId('comment-submit-button').first().click();

    // Leaving edit mode is the observable result of a successful update: the
    // editor closes and the rendered comment shows the new text. A silently
    // saved edit that keeps the editor open (the /comments.update handler
    // failing to respond at all) fails here.
    await expect(editor).not.toBeVisible();
    await expect(page.locator('.page-comment-body').first()).toHaveText(
      editedText,
    );
  });

  // test('Successfully delete comments', async({ page }) => {
  //   await page.goto('/comment');

  //   await page.getByTestId('page-comment-button').click();
  //   await page.getByTestId('comment-delete-button').first().click({ force: true });
  //   await expect(page.getByTestId('page-comment-delete-modal')).toBeVisible();
  //   await page.getByTestId('delete-comment-button').click();

  //   await expect(page.getByTestId('page-comment-button').locator('.grw-count-badge')).toHaveText('0');
  // });

  // TODO: https://redmine.weseek.co.jp/issues/139520
});
