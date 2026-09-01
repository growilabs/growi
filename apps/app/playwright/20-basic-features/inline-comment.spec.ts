import { expect, type Page, test } from '@playwright/test';

import type { CreatedPage } from '../utils/api';
import { createPage, deletePagesCompletely } from '../utils/api';

test.describe('Inline comment', () => {
  // Serial: comment creation is a real, non-idempotent backend write and later
  // tests (reload / reply) depend on the comment created by an earlier test in
  // this file, the same reasoning `20-basic-features/comments.spec.ts` uses.
  test.describe.configure({ mode: 'serial' });

  // Scoped by testInfo.retry (same technique as comments.spec.ts) so a
  // serial-group retry gets a comment-free page instead of inheriting an
  // earlier attempt's inline comments.
  const inlineCommentPagePath = (retry: number) =>
    `/inline-comment-e2e${retry}`;

  const targetSentence =
    'This sentence is the target of an inline comment for end-to-end testing.';
  const pageBody = [
    '# Inline comment E2E',
    '',
    'Some intro text before the target.',
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * Selects `text` inside the rendered page body via a Range set on the
   * exact text-node offsets. A triple-click paragraph-select was tried
   * first and rejected: `Selection.toString()` for a triple-click-selected
   * `<p>` includes a trailing "\n" past the sentence's own text (a Chromium
   * paragraph-select artifact), which corrupts the stored quote and makes
   * every later re-match fail. A script-driven `Selection.addRange()` still
   * fires the native `selectionchange` event `useTextSelection`
   * (SelectionCapture's hook) listens for — it's a real Selection-object
   * mutation, just not a mouse gesture — so this is a faithful trigger, not
   * a bypass of the component under test.
   */
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

  test('Create a page containing the target text', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: inlineCommentPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Selecting text shows the create form; submitting it adds the comment to the list', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);

    // `.wiki` being visible only proves the SSR'd markdown is on the page —
    // SelectionCapture and InlineCommentList mount separately, via
    // `next/dynamic({ ssr: false })` (PageView.tsx), as their own
    // client-only chunk. Waiting for the list to attach is a simple,
    // one-time readiness signal that the inline-comment client bundle has
    // mounted before the one-shot `selectTextInPageBody` (a plain
    // `page.evaluate`, not a Playwright action with built-in retry) fires.
    await expect(page.getByTestId('inline-comment-list')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);

    // Requirement 1.1: a non-empty selection shows the create form.
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      targetSentence,
    );

    const commentText = 'an origin inline comment created by the e2e test';
    // InlineCommentForm's comment input is the same CodeMirror-based editor
    // (CodeMirrorEditorComment) the page-end comment thread uses — driven
    // the same way `20-basic-features/comments.spec.ts` drives it.
    await form.locator('.cm-content').fill(commentText);

    // Requirement 1.2: submitting saves the comment (quote/prefix/suffix/offset).
    await form.getByTestId('inline-comment-submit-button').click();

    // The form closes on a successful submit (SelectionCapture.closeForm).
    await expect(form).not.toBeVisible();

    // Requirement 2.5/2.6: the comment appears in the page's inline-comment list.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);
  });

  test('After reloading the page, the comment persists and its highlight is restored', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));

    // The comment created in the previous test is still there after a fresh
    // page load (list persistence, requirement 2.5).
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(
      'an origin inline comment created by the e2e test',
    );

    // Requirement 2.1/2.2: on reload, the anchor is re-resolved from the
    // saved quote/prefix/suffix against the freshly-rendered body, and a
    // highlight is drawn for the exact-match range. InlineCommentHighlight
    // registers resolved ranges under CSS.highlights (the CSS Custom
    // Highlight API) rather than mutating the DOM (see that component's own
    // doc comment for why), so the registered highlight itself — not a
    // `<mark>` element — is the only DOM-observable signal that re-anchoring
    // actually succeeded. Poll because the highlight is drawn only after
    // AnchorResolver's container-settle detection fires.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Replying to the inline comment nests the reply under the origin comment in the list', async ({
    page,
  }, testInfo) => {
    await page.goto(inlineCommentPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    const replyText = 'a reply to the origin inline comment';
    await item.getByRole('textbox', { name: 'Reply' }).fill(replyText);
    await item.getByRole('button', { name: 'Reply' }).click();

    // Requirement 1.8/2.5: the reply (no anchor of its own) is nested under
    // its origin comment's own list item, not appended as a sibling.
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(replyText);
  });
});
