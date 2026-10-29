import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';

import type { CreatedPage } from '../utils/api';
import { createPage, deletePagesCompletely } from '../utils/api';
import { FILTER_TEST_USER_A } from '../utils/test-users';

const selectTextInPageBody = async (
  page: Page,
  text: string,
): Promise<void> => {
  await page.evaluate((needle) => {
    const container = document.querySelector('.wiki');
    if (container == null) {
      throw new Error('page body container (.wiki) not found');
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node != null) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`text not found in page body: ${needle}`);
  }, text);
};

// The saved highlight has no DOM element of its own, so the popover is opened
// by clicking the middle of the highlighted text's rendered rect (same
// technique as inline-comment.spec.ts).
const centerOfText = (
  page: Page,
  text: string,
): Promise<{ x: number; y: number }> =>
  page.evaluate((needle) => {
    const container = document.querySelector('.wiki');
    if (container == null) {
      throw new Error('page body container (.wiki) not found');
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node != null) {
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    throw new Error(`text not found in page body: ${needle}`);
  }, text);

const highlightRectCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const set = CSS.highlights.get('growi-inline-comment');
    const range = set != null ? [...set][0] : undefined;
    return range instanceof Range ? range.getClientRects().length : 0;
  });

// The hit-test listeners load in a separate lazy chunk from the highlight, so
// the first click after a load can be lost; repeat it until the popover shows.
const openPopoverFromHighlight = async (
  page: Page,
  text: string,
): Promise<Locator> => {
  await expect.poll(() => highlightRectCount(page)).toBeGreaterThan(0);
  const popover = page.getByTestId('inline-comment-preview-popover');
  await expect(async () => {
    if (await popover.isVisible()) {
      return;
    }
    const { x, y } = await centerOfText(page, text);
    await page.mouse.click(x, y);
    await expect(popover).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  return popover;
};

const THUMBS_UP = '👍';
// emoji-mart skin 4 ("Medium") appends the Fitzpatrick type-4 modifier.
const THUMBS_UP_MEDIUM = '👍\u{1F3FD}';

const emojiPicker = (page: Page): Locator => page.locator('em-emoji-picker');

const pickEmoji = async (
  page: Page,
  scope: Locator,
  glyph: string,
  options: { skinTone?: string; useTap?: boolean } = {},
): Promise<void> => {
  const { skinTone, useTap = false } = options;
  const press = (locator: Locator) =>
    useTap ? locator.tap() : locator.click();

  // A comment without reactions reveals its header add button on hover; touch has no hover.
  const addButton = scope.getByRole('button', { name: 'Add reaction' });
  if (!useTap) {
    await scope.hover();
  }
  await press(addButton);
  const picker = emojiPicker(page);
  await expect(picker).toBeVisible();

  if (skinTone != null) {
    await press(
      picker.getByRole('button', { name: 'Choose default skin tone' }),
    );
    // The menu's clickable option is aria-hidden, so it is reached by its label text.
    await press(picker.getByText(skinTone, { exact: true }));
  }

  await picker.getByPlaceholder('Search').fill('thumbs up');
  await press(picker.getByRole('button', { name: glyph, exact: true }).first());
  await expect(picker).toBeHidden();
};

const reactionEmojiButton = (scope: Locator, label: string): Locator =>
  scope.getByRole('button', { name: label, exact: true });

// The count part is labelled "N person/people reacted" (comment_reaction.reacted_count).
const reactionCountButtons = (scope: Locator): Locator =>
  scope.getByRole('button', { name: /reacted$/ });

test.describe('Comment reactions', () => {
  test.describe.configure({ mode: 'serial' });

  // Scoped by retry and repeat so a retried or repeated serial group never
  // inherits an earlier attempt's reactions or races it for the same path.
  const pagePath = ({ retry, repeatEachIndex }: TestInfo) =>
    `/comment-reactions-e2e${retry}-${repeatEachIndex}`;

  const targetSentence = 'This sentence anchors the comment reactions E2E.';
  const pageBody = ['# Comment reactions E2E', '', targetSentence, ''].join(
    '\n',
  );

  const normalCommentText = 'a normal comment for the reactions e2e';
  const inlineCommentText = 'an inline comment for the reactions e2e';
  const inlineReplyText = 'a reply to the inline comment for the reactions e2e';

  const normalComment = (page: Page): Locator =>
    page.locator('.page-comment').filter({ hasText: normalCommentText });

  const inlineReplyInThread = (page: Page): Locator =>
    page.getByTestId('inline-comment-item').getByTestId('inline-comment-reply');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page with a normal comment and an inline comment with a reply', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: pagePath(testInfo),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await page.getByTestId('page-comment-button').click();
    await page.getByTestId('open-comment-editor-button').click();
    await page.locator('.cm-content').fill(normalCommentText);
    await page.getByTestId('comment-submit-button').first().click();
    await expect(normalComment(page)).toBeVisible();

    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill(inlineCommentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item');
    await expect(item).toContainText(inlineCommentText);
    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill(inlineReplyText);
    await item.getByTestId('comment-submit-button').first().click();
    await expect(inlineReplyInThread(page)).toContainText(inlineReplyText);
  });

  test('Adding 👍 from the add-reaction button shows a chip with count 1, and pressing it again removes it (Req 2.1, 2.2, 2.3, 3.3)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const comment = normalComment(page);

    await pickEmoji(page, comment, THUMBS_UP);

    const emojiButton = reactionEmojiButton(comment, '+1');
    await expect(emojiButton).toHaveAttribute('aria-pressed', 'true');
    await expect(reactionCountButtons(comment)).toHaveCount(1);
    await expect(reactionCountButtons(comment)).toHaveText('1');

    // The reaction is stored, not only reflected in the client cache.
    await page.reload();
    await expect(emojiButton).toHaveAttribute('aria-pressed', 'true');
    await expect(reactionCountButtons(comment)).toHaveText('1');

    await emojiButton.click();
    await expect(emojiButton).toHaveCount(0);
    await expect(reactionCountButtons(comment)).toHaveCount(0);

    await page.reload();
    const addButton = comment.getByRole('button', { name: 'Add reaction' });
    // The fade is applied on the wrapper, and `opacity` is not inherited by the button.
    const addReaction = addButton.locator('xpath=..');
    await page.mouse.move(0, 0);
    await expect(addReaction).toHaveCSS('opacity', '0');
    await comment.hover();
    await expect(addReaction).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await expect(addReaction).toHaveCSS('opacity', '0');
    await addButton.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(addButton).toBeFocused();
    await expect(addReaction).toHaveCSS('opacity', '1');
    await expect(reactionCountButtons(comment)).toHaveCount(0);

    // It sits in the header beside the history link, not over the comment body.
    const historyLink = comment.locator('a[id^="page-comment-revision-"]');
    const [addBox, historyBox, bodyBox] = await Promise.all([
      addButton.boundingBox(),
      historyLink.boundingBox(),
      comment.locator('.page-comment-body').boundingBox(),
    ]);
    if (addBox == null || historyBox == null || bodyBox == null) {
      throw new Error('bounding box not available');
    }
    expect(addBox.x).toBeGreaterThanOrEqual(historyBox.x + historyBox.width);
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(bodyBox.y);
  });

  test('With reactions the add button moves to the end of the chip row and stays visible, and the header has none (Req 3.1)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const comment = normalComment(page);

    await pickEmoji(page, comment, THUMBS_UP);
    const emojiButton = reactionEmojiButton(comment, '+1');
    await expect(emojiButton).toBeVisible();

    // Exactly one add button, after the chip, and not hidden behind the hover reveal.
    const addButton = comment.getByRole('button', { name: 'Add reaction' });
    await expect(addButton).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(addButton.locator('xpath=..')).toHaveCSS('opacity', '1');
    const [chipBox, addBox, bodyBox] = await Promise.all([
      emojiButton.boundingBox(),
      addButton.boundingBox(),
      comment.locator('.page-comment-body').boundingBox(),
    ]);
    if (chipBox == null || addBox == null || bodyBox == null) {
      throw new Error('bounding box not available');
    }
    expect(addBox.x).toBeGreaterThanOrEqual(chipBox.x + chipBox.width);
    expect(addBox.y).toBeGreaterThanOrEqual(bodyBox.y + bodyBox.height);

    await emojiButton.click();
    await expect(emojiButton).toHaveCount(0);
  });

  test('After the first reaction is added with the keyboard, focus lands on the add button at the end of the chip row', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const comment = normalComment(page);
    const addButton = comment.getByRole('button', { name: 'Add reaction' });

    await addButton.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(addButton).toBeFocused();
    await page.keyboard.press('Enter');
    const picker = emojiPicker(page);
    await expect(picker).toBeVisible();
    await picker.getByPlaceholder('Search').fill('thumbs up');
    await picker
      .getByRole('button', { name: THUMBS_UP, exact: true })
      .first()
      .click();
    await expect(picker).toBeHidden();

    const emojiButton = reactionEmojiButton(comment, '+1');
    await expect(emojiButton).toBeVisible();
    await expect(addButton).toHaveCount(1);
    await expect(addButton).toBeFocused();

    await emojiButton.click();
    await expect(emojiButton).toHaveCount(0);
  });

  test('In the popover the add button is always visible, without hovering', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const popover = await openPopoverFromHighlight(page, targetSentence);
    const origin = popover.getByTestId('inline-comment-preview-popover-origin');
    const addReaction = origin
      .getByRole('button', { name: 'Add reaction' })
      .locator('xpath=..');

    await page.mouse.move(0, 0);
    await expect(addReaction).toHaveCSS('opacity', '1');
  });

  test('After the first reaction is added with the keyboard in the popover, focus stays in the popover, not in the thread copy', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const popover = await openPopoverFromHighlight(page, targetSentence);
    const origin = popover.getByTestId('inline-comment-preview-popover-origin');
    const addButton = origin.getByRole('button', { name: 'Add reaction' });

    await addButton.focus();
    await page.keyboard.press('Enter');
    const picker = emojiPicker(page);
    await expect(picker).toBeVisible();
    await picker.getByPlaceholder('Search').fill('thumbs up');
    await picker
      .getByRole('button', { name: THUMBS_UP, exact: true })
      .first()
      .click();
    await expect(picker).toBeHidden();

    const emojiButton = reactionEmojiButton(origin, '+1');
    await expect(emojiButton).toBeVisible();
    await expect(addButton).toBeFocused();

    await emojiButton.click();
    await expect(emojiButton).toHaveCount(0);
  });

  test('The same emoji with a different skin tone becomes a separate chip (Req 1.3, 3.5)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const comment = normalComment(page);

    await pickEmoji(page, comment, THUMBS_UP);
    await expect(reactionEmojiButton(comment, '+1')).toBeVisible();

    await pickEmoji(page, comment, THUMBS_UP_MEDIUM, { skinTone: 'Medium' });

    const toned = reactionEmojiButton(comment, '+1 skin-tone-4');
    await expect(toned).toHaveAttribute('aria-pressed', 'true');
    await expect(reactionEmojiButton(comment, '+1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(reactionCountButtons(comment)).toHaveText(['1', '1']);
  });

  test('A reaction on an inline comment reply shows in both the body popover and the thread (Req 1.8, 3.7)', async ({
    page,
  }, testInfo) => {
    await page.goto(pagePath(testInfo));
    const replyInThread = inlineReplyInThread(page);
    await expect(replyInThread).toContainText(inlineReplyText);

    await pickEmoji(page, replyInThread, THUMBS_UP);
    await expect(reactionEmojiButton(replyInThread, '+1')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const popover = await openPopoverFromHighlight(page, targetSentence);
    const replyInPopover = popover.getByTestId(
      'inline-comment-preview-popover-reply',
    );
    await expect(replyInPopover).toContainText(inlineReplyText);
    const popoverEmojiButton = reactionEmojiButton(replyInPopover, '+1');
    await expect(popoverEmojiButton).toHaveAttribute('aria-pressed', 'true');
    await expect(reactionCountButtons(replyInPopover)).toHaveText('1');

    // The other direction: removing it from the popover clears the thread too.
    await popoverEmojiButton.click();
    await expect(popoverEmojiButton).toHaveCount(0);
    await expect(reactionEmojiButton(replyInThread, '+1')).toHaveCount(0);
  });

  test('The share-link view shows normal comment chips without the add-reaction button, and no inline comment reactions (Req 5.6, 6.2, 6.3)', async ({
    browser,
    page,
    request,
  }, testInfo) => {
    if (createdPage == null) throw new Error('page was not created');

    // Give the inline reply a reaction so its absence below is meaningful.
    await page.goto(pagePath(testInfo));
    const replyInThread = inlineReplyInThread(page);
    await pickEmoji(page, replyInThread, THUMBS_UP);
    await expect(reactionCountButtons(replyInThread)).toHaveText('1');
    await expect(reactionCountButtons(normalComment(page))).toHaveCount(2);

    const shareLinkRes = await request.post('/_api/v3/share-links', {
      data: { relatedPage: createdPage.pageId },
    });
    expect(
      shareLinkRes.ok(),
      `share link creation failed: ${shareLinkRes.status()} ${await shareLinkRes.text()}`,
    ).toBe(true);
    const shareLink = await shareLinkRes.json();
    const shareLinkId: string = shareLink.id ?? shareLink._id;

    // A cookie-less context: logging out would end the session other specs reuse.
    const guestContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: 'http://localhost:3000',
    });
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto(`/share/${shareLinkId}`);
      const guestComment = normalComment(guestPage);
      await expect(guestComment).toBeVisible();

      await expect(reactionCountButtons(guestComment)).toHaveText(['1', '1']);
      await expect(guestComment.getByText(THUMBS_UP).first()).toBeVisible();
      // Read-only: the emoji part is not a toggle and there is no add-reaction button.
      await expect(
        guestComment.getByRole('button', { name: '+1', exact: true }),
      ).toHaveCount(0);
      await expect(
        guestPage.getByRole('button', { name: 'Add reaction' }),
      ).toHaveCount(0);

      // The inline reply's reaction is the only other one, and it is not shown.
      await expect(guestPage.getByText(inlineReplyText)).toHaveCount(0);
      await expect(reactionCountButtons(guestPage.locator('body'))).toHaveCount(
        2,
      );
    } finally {
      await guestContext.close();
    }
  });

  test.describe('on a touch phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("Tapping the count lists who reacted without changing the reaction; tapping the emoji adds and removes the viewer's own reaction (Req 1.5, 2.1, 2.2)", async ({
      browser,
      page,
    }, testInfo) => {
      await page.goto(pagePath(testInfo));
      const comment = normalComment(page);
      const emojiButton = reactionEmojiButton(comment, '+1');
      const toned = reactionEmojiButton(comment, '+1 skin-tone-4');

      // Tapping the emoji of a chip only the viewer reacted with removes it.
      await toned.tap();
      await expect(toned).toHaveCount(0);
      await emojiButton.tap();
      await expect(emojiButton).toHaveCount(0);
      await expect(reactionCountButtons(comment)).toHaveCount(0);

      // Another user's 👍 gives the viewer a chip they have not reacted with.
      const otherContext = await browser.newContext({
        storageState: FILTER_TEST_USER_A.authFile,
        baseURL: 'http://localhost:3000',
      });
      try {
        const otherPage = await otherContext.newPage();
        await otherPage.goto(pagePath(testInfo));
        const otherComment = normalComment(otherPage);
        await pickEmoji(otherPage, otherComment, THUMBS_UP);
        await expect(reactionEmojiButton(otherComment, '+1')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      } finally {
        await otherContext.close();
      }

      await page.reload();
      const onePerson = comment.getByRole('button', {
        name: '1 person reacted',
      });
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'false');
      await expect(onePerson).toHaveText('1');

      await onePerson.tap();
      const usersPopover = page
        .locator('.popover')
        .filter({ hasText: 'Reacted by' });
      await expect(usersPopover).toBeVisible();
      await expect(usersPopover.getByRole('listitem')).toHaveText([
        FILTER_TEST_USER_A.name,
      ]);
      await expect(onePerson).toHaveAttribute('aria-expanded', 'true');
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'false');

      // A mis-tap would have sent a write; the stored state must be unchanged.
      await page.reload();
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'false');
      await expect(onePerson).toHaveText('1');

      await emojiButton.tap();
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'true');
      await expect(
        comment.getByRole('button', { name: '2 people reacted' }),
      ).toHaveText('2');

      await emojiButton.tap();
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'false');
      await expect(onePerson).toHaveText('1');

      await page.reload();
      await expect(emojiButton).toHaveAttribute('aria-pressed', 'false');
      await expect(onePerson).toHaveText('1');
    });
  });
});
