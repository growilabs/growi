import { expect, test } from '@playwright/test';

test.describe('Comment', () => {
  // make tests run in serial
  test.describe.configure({ mode: 'serial' });

  // A serial group's retry re-runs every test in the group from the top, but
  // comment creation below is a real, non-idempotent backend write. Reusing
  // a fixed page path across retries lets an earlier attempt's comments
  // leak into the next one, so a locator with no index (`.page-comment-body`,
  // `getByTestId('comment-reply-button')`) hits a strict-mode "resolved to
  // 2 elements" violation once duplicates pile up. Scoping the path by
  // testInfo.retry gives every attempt its own comment-free page.
  const commentPagePath = (retry: number) => `/comment-retry${retry}`;

  test('Create comment page', async ({ page }, testInfo) => {
    await page.goto(commentPagePath(testInfo.retry));
    await page.getByTestId('editor-button').click();
    await page.getByTestId('save-page-btn').click();
    await expect(page.locator('.page-meta')).toBeVisible();
  });

  test('Successfully add comments', async ({ page }, testInfo) => {
    const commentText = 'add comment';
    await page.goto(commentPagePath(testInfo.retry));

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

  test('Successfully reply comments', async ({ page }, testInfo) => {
    const commentText = 'reply comment';
    await page.goto(commentPagePath(testInfo.retry));

    // Reply comment
    //
    // A single click on the reply button is not enough to guarantee the
    // reply editor mounts: the click can land before its handler is
    // attached (or before the showEditorIds state update that swaps the
    // button for <CommentEditor> is flushed), in which case it is silently
    // dropped and `.cm-content` never enters the DOM at all -- not merely
    // slow to become visible (see issue #11785, `.fill()`'s own auto-wait
    // already covers "slow", so a plain `toBeVisible()` gate before fill
    // would time out identically). Retry the click itself until the editor
    // is actually up. The reply button unmounts once the click succeeds, so
    // guard re-clicking with isVisible() to avoid clicking a stale/gone
    // locator on a later retry attempt.
    const replyButton = page.getByTestId('comment-reply-button');
    await expect(async () => {
      if (await replyButton.isVisible()) {
        await replyButton.click();
      }
      await expect(page.locator('.cm-content')).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 25_000 });

    await page.locator('.cm-content').fill(commentText);
    await page.getByTestId('comment-submit-button').first().click();

    await expect(page.locator('.page-comment-body').nth(1)).toHaveText(
      commentText,
    );
    await expect(
      page.getByTestId('page-comment-button').locator('.grw-count-badge'),
    ).toHaveText('2');
  });

  test('Successfully edit comments', async ({ page }, testInfo) => {
    const editedText = 'edited comment';
    await page.goto(commentPagePath(testInfo.retry));

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
