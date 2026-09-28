import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';

import type { CreatedPage } from '../utils/api';
import { createPage, deletePagesCompletely, updatePage } from '../utils/api';
import { FILTER_TEST_USER_A } from '../utils/test-users';

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
 *
 * Hoisted to module scope (rather than declared per `describe` block) so
 * both the happy-path suite and the best-effort-fallback suite below share
 * one implementation.
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

/**
 * The viewport-relative center point of the exact text run `text` --
 * located via a `TreeWalker` + a throwaway `Range` around just that text
 * (same technique `selectTextInPageBody` uses to build a selection Range,
 * reused here to read `getBoundingClientRect()` instead).
 *
 * This is deliberately NOT "hover/click the wrapping element" (e.g.
 * `locator.hover()` on the paragraph): a `.hover()`/`.click()` targets the
 * center of the ELEMENT's own box, but a block-level `<p>` spans the full
 * container width while its rendered text is left-aligned and narrower --
 * so the element's center can sit well past the end of the actual glyphs,
 * outside every rect `useHighlightHitTest`'s `getClientRects()`-based hit
 * test compares against (see `use-highlight-hit-test.ts`). Moving the mouse
 * to the middle of the TEXT's own bounding rect is what actually lands
 * inside the saved highlight's hit-testable area.
 *
 * Hoisted to module scope (same reasoning as `selectTextInPageBody` above)
 * so both the body-popover suite and the marker-less-DOM-change suite share
 * one implementation.
 */
const centerOfText = (
  targetPage: Page,
  text: string,
): Promise<{ x: number; y: number }> =>
  targetPage.evaluate((needle) => {
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
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
      node = walker.nextNode();
    }
    throw new Error(`text not found in page body: ${needle}`);
  }, text);

/**
 * Moves the mouse to the middle of `text`'s own rendered rect -- the
 * `pointermove` this dispatches bubbles to `document`, which is where
 * `useHighlightHitTest`'s desktop-only hover listener is attached (the
 * saved highlight has no DOM element of its own to target directly; see
 * design.md 決定2).
 */
const hoverText = async (targetPage: Page, text: string): Promise<void> => {
  const { x, y } = await centerOfText(targetPage, text);
  await targetPage.mouse.move(x, y);
};

/** Same rationale as `hoverText`, for a real click/tap at that same point. */
const clickText = async (targetPage: Page, text: string): Promise<void> => {
  const { x, y } = await centerOfText(targetPage, text);
  await targetPage.mouse.click(x, y);
};

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
    // SelectionCapture mounts separately, via `next/dynamic({ ssr: false })`
    // (PageView.tsx), as its own client-only chunk. It renders an invisible
    // `inline-comment-ready` marker once it settles into its idle stage, and
    // waiting for that marker to attach is a simple, one-time readiness
    // signal that the inline-comment client bundle has mounted before the
    // one-shot `selectTextInPageBody` (a plain `page.evaluate`, not a
    // Playwright action with built-in retry) fires.
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);

    // Requirement 1.1 (inline-comment-selection-ux): a non-empty selection
    // shows only the lightweight create action first, not the form itself.
    const actionButton = page.getByTestId('selection-action-button');
    await expect(actionButton).toBeVisible();

    // Requirement 2.1: choosing the action expands it into the input form.
    await actionButton.click();
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
    // The reply input is not a plain always-visible `<textarea>`/"Reply"
    // button pair -- it's a "Reply..." toggle that must be clicked first to
    // reveal `CommentEditor`, the literal same editor the normal
    // page-bottom comment thread uses for its own replies. `.first()` on
    // the submit button: `CommentEditor` renders a desktop and a mobile
    // copy of it (toggled by CSS breakpoint), both present in the DOM.
    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill(replyText);
    await item.getByTestId('comment-submit-button').first().click();

    // Requirement 1.8/2.5: the reply (no anchor of its own) is nested under
    // its origin comment's own list item, not appended as a sibling.
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(replyText);
  });
});

test.describe('Inline comment - mention picker and multi-line submission', () => {
  // Serial: the mention-picker and multi-line-submission tests both open a
  // fresh form via a fresh page.goto, so they do not depend on each other's
  // form state -- but they share one created page, the same reasoning the
  // other suites in this file use for the page-creation test.
  test.describe.configure({ mode: 'serial' });

  const mentionPagePath = (retry: number) =>
    `/inline-comment-e2e-mention${retry}`;

  const targetSentence =
    'This sentence anchors the mention-picker end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - mention picker',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: mentionPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Choosing a candidate from the mention picker inserts "@<username> " at the cursor position, not merely appended', async ({
    page,
  }, testInfo) => {
    await page.goto(mentionPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    const commentEditor = form.locator('.cm-content');

    // Requirement 3.3 says the picked mention is inserted into the comment
    // body -- but "inserted" and "appended" would look identical if the
    // cursor always happens to sit at the end of an empty editor. To prove
    // this is a genuine at-cursor insertion (InlineCommentForm's
    // `insertMention` calling `codeMirrorEditor.insertText`, not a
    // textarea-level append), type text around the cursor first, then move
    // the cursor to the middle before opening the picker: "AZ" -> ArrowLeft
    // -> cursor sits between "A" and "Z".
    await commentEditor.click();
    await commentEditor.pressSequentially('AZ');
    await page.keyboard.press('ArrowLeft');

    // Requirement 3.1: the mention picker is a separate operation from the
    // body input itself.
    const mentionButton = form.getByTestId('mention-picker-button');
    await mentionButton.click();

    // Requirement 3.2: choosing the operation shows a list of mentionable
    // users. The logged-in admin user (playwright/utils/login.ts) is always
    // a real, mentionable user, so this list is never empty in this
    // environment.
    // Scoped to the mention picker's own dropdown menu (its sibling in the
    // DOM), not just `.dropdown-item` anywhere in the form -- the comment
    // editor's own toolbar renders several other, normally-hidden
    // dropdown-item lists (table/drawio template menus) that a looser
    // selector would match instead.
    const mentionMenu = mentionButton.locator(
      'xpath=following-sibling::div[contains(concat(" ", normalize-space(@class), " "), " dropdown-menu ")]',
    );
    const firstCandidate = mentionMenu.locator('.dropdown-item').first();
    await expect(firstCandidate).toBeVisible();
    const candidateUsername = await firstCandidate
      .locator('span')
      .first()
      .innerText();

    // Requirement 3.3: selecting the candidate inserts its mention into the
    // comment body, at the cursor position recorded above -- landing between
    // "A" and "Z", not after them.
    await firstCandidate.click();
    await expect(commentEditor).toHaveText(`A@${candidateUsername} Z`);
  });

  test('Submitting a multi-line comment body closes the form and the comment appears in the bottom list as an inline comment', async ({
    page,
  }, testInfo) => {
    await page.goto(mentionPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    const firstLine = 'a multi-line inline comment created by the e2e test';
    const secondLine = 'its second line, typed via a real Enter keypress';
    const commentEditor = form.locator('.cm-content');
    // `.fill()` (used by the single-line scenarios elsewhere in this file)
    // sets the whole editor value in one shot; typing the Enter keypress
    // explicitly here is what actually exercises a multi-line body, the same
    // technique `presentation.spec.ts` and `emacs-keymap.spec.ts` use for a
    // multi-line `.cm-content` fill.
    await commentEditor.fill(firstLine);
    await commentEditor.press('End');
    await commentEditor.press('Enter');
    await commentEditor.pressSequentially(secondLine);
    await expect(commentEditor).toContainText(firstLine);
    await expect(commentEditor).toContainText(secondLine);

    // Requirement 2.4: submitting closes the input form.
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    // Requirement 3.1/2.5 continuity with the base `inline-comment` E2E: the
    // comment shows up in the page's bottom inline-comment list, in the same
    // "inline-comment-item contains the comment text" display format already
    // established above (`inline-comment-item` -> `toContainText`).
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(firstLine);
    await expect(item).toContainText(secondLine);
  });
});

test.describe('Inline comment - action button lifecycle before the form opens', () => {
  // Serial: the second test depends on the page created by the first, the
  // same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const actionButtonPagePath = (retry: number) =>
    `/inline-comment-e2e-action-button${retry}`;

  const firstSentence =
    'First target sentence for action button positioning tests.';
  const secondSentence =
    'Second target sentence for action button positioning tests, far below the first.';

  // Enough filler paragraphs to put a large, reliable vertical gap between
  // `firstSentence` and `secondSentence`, so a passing "the button moved"
  // assertion below cannot be a false positive from sub-pixel layout noise.
  const fillerParagraphs = Array.from(
    { length: 20 },
    (_, i) =>
      `Filler paragraph ${i} pushes the second target sentence well below the first one.`,
  );
  const pageBody = [
    '# Inline comment E2E - action button lifecycle',
    '',
    firstSentence,
    '',
    ...fillerParagraphs.flatMap((paragraph) => [paragraph, '']),
    secondSentence,
    '',
  ].join('\n');

  /**
   * The bounding rect of the (single) current DOM Range, via the same
   * `getBoundingClientRect()` mechanism Playwright's `Locator.boundingBox()`
   * uses under the hood — confirmed empirically (a fixture with a scrolled
   * page: both report identical, scroll-adjusted, viewport-relative
   * coordinates) so the two are safe to diff directly below. Used to assert
   * the action button is actually positioned near the selection
   * (Requirement 1.1) rather than merely visible somewhere.
   */
  const getSelectionRect = (
    targetPage: Page,
  ): Promise<{ top: number; bottom: number } | null> => {
    return targetPage.evaluate(() => {
      const selection = window.getSelection();
      if (selection == null || selection.rangeCount === 0) {
        return null;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
  };

  const clearSelectionInPageBody = async (targetPage: Page): Promise<void> => {
    await targetPage.evaluate(() => {
      window.getSelection()?.removeAllRanges();
    });
  };

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page containing two widely-separated target sentences', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: actionButtonPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(firstSentence);
    await expect(page.locator('.wiki').first()).toContainText(secondSentence);
  });

  test('The action button appears near a selection, tracks a changed selection, and disappears once the selection is cleared', async ({
    page,
  }, testInfo) => {
    await page.goto(actionButtonPagePath(testInfo.retry));
    await expect(page.locator('.wiki').first()).toContainText(firstSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const actionButton = page.getByTestId('selection-action-button');

    // Requirement 1.2 (contrast case for the button appearing at all): no
    // selection yet, so no action button.
    await expect(actionButton).not.toBeVisible();

    // Requirement 1.1: selecting non-empty text shows the action button near
    // the selection — assert this quantitatively (the button's vertical
    // position is close to the selection's own rect), not merely "visible".
    await selectTextInPageBody(page, firstSentence);
    await expect(actionButton).toBeVisible();

    const firstButtonBox = await actionButton.boundingBox();
    const firstSelectionRect = await getSelectionRect(page);
    if (firstButtonBox == null || firstSelectionRect == null) {
      throw new Error('expected both a button box and a selection rect');
    }
    // The popover sits directly above/below the selection (SelectionPopover's
    // Popper placement) — well within a generous 200px tolerance, whereas the
    // page has ~20 filler paragraphs of vertical room it would land in if
    // positioning were broken (e.g. pinned to the viewport origin).
    expect(Math.abs(firstButtonBox.y - firstSelectionRect.top)).toBeLessThan(
      200,
    );

    // Requirement 1.3: changing the selection (without ever clicking the
    // button) moves the action button to track the new selection. Poll
    // because the reposition happens asynchronously (selectionchange →
    // recapture → Popper recompute), not synchronously with the selection
    // change itself.
    await selectTextInPageBody(page, secondSentence);
    await expect
      .poll(async () => {
        const box = await actionButton.boundingBox();
        return box == null ? null : box.y - firstButtonBox.y;
      })
      .toBeGreaterThan(200);

    const secondButtonBox = await actionButton.boundingBox();
    const secondSelectionRect = await getSelectionRect(page);
    if (secondButtonBox == null || secondSelectionRect == null) {
      throw new Error('expected both a button box and a selection rect');
    }
    expect(Math.abs(secondButtonBox.y - secondSelectionRect.top)).toBeLessThan(
      200,
    );

    // Requirement 1.4: clearing the selection before the button is chosen
    // makes it disappear.
    await clearSelectionInPageBody(page);
    await expect(actionButton).not.toBeVisible();
  });
});

test.describe('Inline comment - best-effort fallback after the anchored text is edited away', () => {
  // Serial for the same reason as the suite above: the second test depends
  // on the comment created by the first, real backend state.
  test.describe.configure({ mode: 'serial' });

  const fallbackPagePath = (retry: number) =>
    `/inline-comment-e2e-fallback${retry}`;

  // Long enough that even the fuzzy matcher's tolerance
  // (`FUZZY_MATCH_ERROR_RATE = 0.2`, capped at `FUZZY_MATCH_MAX_ERRORS = 20`
  // — see quote-matcher.ts) cannot bridge the gap to its replacement below.
  const targetSentence =
    'This sentence will be entirely removed from the page body after the comment is created, breaking its anchor on purpose.';
  const pageBody = [
    '# Inline comment E2E - fallback',
    '',
    'Some intro text before the target.',
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  // A short, wholly unrelated replacement for `targetSentence`. Levenshtein
  // distance is always at least the length difference between the two
  // strings, so `targetSentence.length - replacementSentence.length` alone
  // (119 - 10 = 109) already exceeds `matchQuote`'s worst-case tolerance of
  // `min(ceil(119 * 0.2), 20) = 20` errors — independent of how much (or
  // little) the wording happens to overlap. This makes the "quote is
  // unrecoverable" outcome deterministic rather than a near-miss that could
  // flip to a fuzzy match under an unlucky character overlap.
  const replacementSentence = 'Unrelated.';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page, then create an inline comment on a sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: fallbackPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);

    // Requirement 2.1: the create action must be chosen before the form opens.
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form
      .locator('.cm-content')
      .fill('a comment whose anchor will be lost');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // Requirement 2.1/2.2: sanity-check the highlight is actually drawn
    // before the edit — otherwise a "no highlight after edit" assertion
    // later would be true for the wrong reason (it was never drawn at all).
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('After the commented-on text is completely edited away and the page reloads, the highlight disappears but the comment remains listed', async ({
    page,
    request,
  }) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    // Requirement 5.1/5.3: replace the whole paragraph that contained the
    // quoted sentence with unrelated text — not merely shifted or
    // reworded, but gone — so neither exact nor fuzzy matching in
    // `matchQuote` can locate it in the freshly-rendered body.
    const editedBody = pageBody.replace(targetSentence, replacementSentence);
    createdPage = await updatePage(request, createdPage, editedBody);

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(
      replacementSentence,
    );
    await expect(page.locator('.wiki').first()).not.toContainText(
      targetSentence,
    );

    // Requirement 2.5: the comment is still in the list (not deleted, not
    // hidden) even though its anchor could no longer be resolved.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText('a comment whose anchor will be lost');

    // Requirement 2.4/5.3: no highlight is drawn for the now-unresolvable
    // anchor. `item` being visible already proves the inline-comment data
    // (the same fetch `useAnchorResolver` reads its anchors from) has
    // loaded, so by this point AnchorResolver's anchors-content-change
    // effect (`use-anchor-resolver.ts`) has already run at least once against
    // the freshly-rendered body — there is no later trigger that could still
    // produce a highlight. The extra wait below only guards against a
    // (self-healing) re-anchor via a second `useContainerSettle` tick
    // within its `WATCH_TIMEOUT_MS` window flipping this from 0 to
    // non-zero after the first check.
    const highlightCount = () =>
      page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      );
    expect(await highlightCount()).toBe(0);
    await page.waitForTimeout(1000);
    expect(await highlightCount()).toBe(0);
  });
});

test.describe('Inline comment - visual consistency of the creation UI', () => {
  // Serial: every test in this suite reuses the one page created by the
  // first test, the same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const visualConsistencyPagePath = (retry: number) =>
    `/inline-comment-e2e-visual-consistency${retry}`;

  const targetSentence =
    'This sentence anchors the visual-consistency end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - visual consistency',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * `next-themes` only writes the `data-bs-theme` attribute in reaction to a
   * user-triggered theme change; nothing was observed to overwrite it once
   * set directly (verified by reading the attribute right back after each
   * call below across all three tests in this suite). Writing it directly
   * on `<html>` is therefore a faithful stand-in for a real theme switch:
   * it is the exact attribute/selector Bootstrap's `color-mode` mixin reads
   * (`[data-bs-theme="dark"] { ... }`, `bootstrap/scss/mixins/_color-mode.scss`).
   * Design.md's Testing Strategy ("テーマ追随") calls out this same technique
   * for exercising Req 11.3/11.4 without going through the admin
   * theme-customize screen.
   */
  const setBsTheme = async (
    targetPage: Page,
    theme: 'light' | 'dark',
  ): Promise<void> => {
    await targetPage.evaluate((t) => {
      document.documentElement.setAttribute('data-bs-theme', t);
    }, theme);
  };

  /**
   * Bootstrap's base `.btn` rule (and other themed elements exercised here)
   * transitions `background-color`/`border-color`/`color` over ~150ms
   * (`bootstrap/scss/_variables.scss`'s `$btn-transition`): the CSS custom
   * property driving the color (e.g. `--bs-btn-bg`) updates the instant
   * `data-bs-theme` changes, but the *painted* value animates toward it, so
   * a `getComputedStyle` read taken right after `setBsTheme` was observed
   * (empirically, including via Chrome DevTools Protocol's
   * `CSS.getComputedStyleForNode`) to still be mid-transition rather than
   * the settled target color.
   *
   * Bootstrap's own transition mixin already turns transitions off under
   * `prefers-reduced-motion: reduce`, and that would normally be the
   * cleaner opt-out (`test.use({ reducedMotion: 'reduce' })`) — but that
   * was tried first and, in this environment, left
   * `window.matchMedia('(prefers-reduced-motion: reduce)').matches` false
   * (verified empirically; `test.use({ colorScheme: 'dark' })` in the same
   * spot correctly flips `prefers-color-scheme`, so this is specific to the
   * `reducedMotion` context option here, not `test.use` in general).
   * Injecting a `!important` stylesheet after each navigation is a
   * deterministic substitute that does not depend on that context option
   * behaving as documented.
   */
  const disableCssTransitions = async (targetPage: Page): Promise<void> => {
    await targetPage.addStyleTag({
      content:
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });
  };

  type ThemedColors = {
    backgroundColor: string;
    borderColor: string;
    color: string;
  };

  const readThemedColors = (
    locator: ReturnType<Page['locator']>,
  ): Promise<ThemedColors> =>
    locator.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        color: style.color,
      };
    });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: visualConsistencyPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Switching data-bs-theme changes the action button colors, and switching back restores them (Req 11.3, 11.4)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    const actionButton = page.getByTestId('selection-action-button');
    await expect(actionButton).toBeVisible();

    await setBsTheme(page, 'light');
    const lightColors = await readThemedColors(actionButton);

    // Requirement 11.3/11.4: switching the theme (light -> dark here, the
    // direction Req 11.4 names explicitly) changes background/border/text
    // color, because SelectionActionButton.module.scss maps its Bootstrap
    // button variables onto --bs-body-bg / --bs-border-color / --bs-body-color,
    // which the dark [data-bs-theme="dark"] rule set redefines.
    await setBsTheme(page, 'dark');
    const darkColors = await readThemedColors(actionButton);
    expect(darkColors.backgroundColor).not.toBe(lightColors.backgroundColor);
    expect(darkColors.borderColor).not.toBe(lightColors.borderColor);
    expect(darkColors.color).not.toBe(lightColors.color);

    // Non-vacuousness / round-trip check: switching back to light restores
    // the exact colors captured the first time. This rules out the earlier
    // "changed" assertion being a false positive from unrelated timing/CSS
    // recalculation noise rather than a genuine theme-attribute dependency
    // (e.g. it would fail this round-trip if the color depended on paint
    // order or some one-shot transition instead of the live attribute).
    await setBsTheme(page, 'light');
    const lightColorsAgain = await readThemedColors(actionButton);
    expect(lightColorsAgain).toEqual(lightColors);
  });

  test('Switching data-bs-theme changes the input form colors, and switching back restores them (Req 11.3, 11.4)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await setBsTheme(page, 'light');
    const lightColors = await readThemedColors(form);

    // Requirement 11.3/11.4: the form's `bg-body border` classes
    // (InlineCommentForm.tsx) read --bs-body-bg / --bs-border-color, and the
    // form has no explicit text-color class so it inherits --bs-body-color —
    // all three change value under [data-bs-theme="dark"].
    await setBsTheme(page, 'dark');
    const darkColors = await readThemedColors(form);
    expect(darkColors.backgroundColor).not.toBe(lightColors.backgroundColor);
    expect(darkColors.borderColor).not.toBe(lightColors.borderColor);
    expect(darkColors.color).not.toBe(lightColors.color);

    // Round-trip, same reasoning as the action-button test above.
    await setBsTheme(page, 'light');
    const lightColorsAgain = await readThemedColors(form);
    expect(lightColorsAgain).toEqual(lightColors);
  });

  test('The input form hides the CodeMirror toolbar and the line-number/fold gutters (design.md decision 5)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    // Wait for the CodeMirror editor itself to be mounted before asserting
    // on the absence of its sub-parts, so a "0 matches" result reliably
    // means "hidden by hideToolbar/basicSetup", not "editor not mounted yet".
    await expect(form.locator('.cm-content')).toBeVisible();

    // `hideToolbar` (InlineCommentForm.tsx passing it to
    // CodeMirrorEditorComment, packages/editor's CodeMirrorEditor.tsx:248)
    // must suppress the whole Toolbar, including the template button — a
    // control that renders unconditionally whenever the toolbar exists
    // (TemplateButton.tsx has no feature gate), so its absence is a direct
    // proxy for "the toolbar is not rendered" rather than merely CSS-hidden.
    await expect(form.getByTestId('open-template-button')).toHaveCount(0);

    // `cmProps.basicSetup: { lineNumbers: false, foldGutter: false }`
    // (InlineCommentForm.tsx) must remove the gutter container entirely --
    // `.cm-gutters` is CodeMirror's own wrapper for the line-number and fold
    // gutters (@codemirror/view), and it is only emitted when at least one
    // gutter extension is active.
    await expect(form.locator('.cm-gutters')).toHaveCount(0);
  });

  test('The comment editor takes up most of the row width, not a sliver (regression: a flex-basis: auto item collapses because the editor sets width: 100% on itself)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    const formBox = await form.boundingBox();
    const editorBox = await form.locator('.cm-content').boundingBox();
    if (formBox == null || editorBox == null) {
      throw new Error('form or editor bounding box unavailable');
    }
    // A comfortable majority of the row, not just enough to render a cursor --
    // the mention/submit button column and padding account for the rest.
    expect(editorBox.width).toBeGreaterThan(formBox.width * 0.5);
  });

  test('The form width stays within a narrow viewport instead of overflowing it', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    const formBox = await form.boundingBox();
    if (formBox == null) {
      throw new Error('form bounding box unavailable');
    }
    expect(formBox.x).toBeGreaterThanOrEqual(0);
    expect(formBox.x + formBox.width).toBeLessThanOrEqual(375);
  });

  test('Escape closes only the mention picker dropdown when it is open, and closes the form on a second press', async ({
    page,
  }, testInfo) => {
    await page.goto(visualConsistencyPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.getByTestId('mention-picker-button').click();
    const menu = form.getByRole('menu');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    // The form itself must survive this first Escape -- the dropdown alone
    // consumed it.
    await expect(form).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(form).not.toBeVisible();
  });
});

test.describe('Inline comment - highlight color stays consistent across the pending (selecting/composing) states, and switches to a distinct color once saved (Req 1.1, 1.2, 1.5, 12.4-12.7)', () => {
  // Serial: every test in this suite reuses the one page created by the
  // first test, the same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const highlightConsistencyPagePath = (retry: number) =>
    `/inline-comment-e2e-highlight-consistency${retry}`;

  const targetSentence =
    'This sentence anchors the highlight-color-consistency end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - highlight color consistency',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * Reads the *computed* `background-color` of a CSS pseudo-element
   * (`::selection` or `::highlight(<name>)`) as it applies to the element
   * that wraps `text`, via `getComputedStyle(el, pseudo)`.
   *
   * This was chosen over sampling painted pixels from a screenshot (the
   * more obvious "read the rendered color" technique) after an empirical
   * probe against this repo's own Playwright/Chromium build confirmed both
   * pseudo forms resolve through `getComputedStyle`'s second (pseudo-element)
   * argument -- Chromium computes the cascade for `::selection` and for
   * `::highlight()` independently of whether any text is presently
   * selected/registered, so this reads the *rule* that would paint, not a
   * rasterized snapshot of it. That is the more robust and maintainable
   * choice here: no PNG-decoding dependency (this repo has none -- `sharp`
   * only appears in the lockfile as an unrelated transitive dependency), no
   * pixel-coordinate math tied to font metrics/line-wrapping, and no
   * flakiness from anti-aliased edges. It is a faithful stand-in for "what
   * gets painted" specifically because each state below queries the one
   * pseudo that CSS's own highlight-painting order
   * (`::highlight() < ::selection`, see design.md decision 1) actually puts
   * on top in that state: `::selection` while a real browser selection
   * exists (selecting), `::highlight(growi-inline-comment-pending)` once
   * the browser selection is dropped but the form is still open (composing,
   * PendingSelectionHighlight), and `::highlight(growi-inline-comment)` once
   * saved (InlineCommentHighlight).
   */
  const getPseudoBackgroundColor = (
    targetPage: Page,
    text: string,
    pseudo: string,
  ): Promise<string> =>
    targetPage.evaluate(
      ({ needle, pseudoSelector }) => {
        const container = document.querySelector('.wiki');
        if (container == null) {
          throw new Error('page body container (.wiki) not found');
        }
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let node = walker.nextNode();
        while (node != null) {
          if (node.textContent?.includes(needle)) {
            const el = node.parentElement;
            if (el == null) {
              throw new Error('matched text node has no parent element');
            }
            return window.getComputedStyle(el, pseudoSelector).backgroundColor;
          }
          node = walker.nextNode();
        }
        throw new Error(`text not found in page body: ${needle}`);
      },
      { needle: text, pseudoSelector: pseudo },
    );

  /**
   * Independently resolves `--grw-inline-comment-marker-bg` (the SAVED
   * highlight's color token) to a computed color, by applying it to a
   * throwaway element rather than hard-coding the expected color (e.g.
   * `#FFFA90`) in the test -- design.md decision 4 notes the default is a
   * deliberate, revisitable choice, so this test should keep passing if that
   * default value alone ever changes.
   */
  const readInlineCommentMarkerColor = (targetPage: Page): Promise<string> =>
    targetPage.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--grw-inline-comment-marker-bg)';
      document.body.appendChild(probe);
      const color = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });

  /**
   * Independently resolves the PENDING (selecting/composing) highlight's
   * actual painted color -- `color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending)
   * 70%, transparent)`, the exact expression `PendingSelectionHighlight.tsx`
   * emits -- again by applying it to a throwaway element rather than
   * hard-coding a resolved color, so this stays correct if the pending
   * token's default value changes. Kept as its own helper (distinct from
   * `readInlineCommentMarkerColor` above) because Requirement 1.1/1.2 makes
   * the pending and saved colors deliberately DIFFERENT tokens now, not two
   * readings of the same one.
   */
  const readPendingHighlightColor = (targetPage: Page): Promise<string> =>
    targetPage.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor =
        'color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending) 70%, transparent)';
      document.body.appendChild(probe);
      const color = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: highlightConsistencyPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('The pending range keeps a consistent color across selecting and composing, and switches to the distinct saved color once committed', async ({
    page,
  }, testInfo) => {
    await page.goto(highlightConsistencyPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const markerColor = await readInlineCommentMarkerColor(page);
    const pendingColor = await readPendingHighlightColor(page);
    // Sanity: neither color is the browser's fully transparent default --
    // otherwise every comparison below would pass vacuously (states all
    // painting "nothing").
    expect(markerColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(pendingColor).not.toBe('rgba(0, 0, 0, 0)');
    // Requirement 1.1/1.2 (this spec) retracts the previous
    // inline-comment-visual-consistency spec's Requirement 12.8, which
    // required the saved and pending colors to be identical: the pending
    // (selecting/composing) color must now be genuinely distinguishable
    // from the saved color, not merely a differently-computed reading of
    // the same one, so an overlapping selection over an already-saved
    // comment can show both at once (see the "stays distinguishable" suite
    // further down this file).
    expect(pendingColor).not.toBe(markerColor);

    // --- State 1: selecting (Req 12.4) ---
    // Requirement 12.4: a plain text selection, before the create action is
    // even chosen, is painted the pending color -- CSS's own painting order
    // (`::highlight() < ::selection`) puts `::selection` on top here, so
    // this is the pseudo that actually determines what's painted.
    await selectTextInPageBody(page, targetSentence);
    await expect(page.getByTestId('selection-action-button')).toBeVisible();
    const selectingColor = await getPseudoBackgroundColor(
      page,
      targetSentence,
      '::selection',
    );
    expect(selectingColor).toBe(pendingColor);

    // --- State 2: composing (Req 12.5, 12.6) ---
    // Choosing the create action opens the form; clicking into its editor
    // moves focus into the input, which drops the browser's native
    // selection -- the same "input欄にカーソルを移してブラウザ上の選択が解除
    // された" state Req 12.6 names. Confirmed below via `window.getSelection()`
    // before reading the composing-state color, so a false pass can't be
    // hiding behind a selection that never actually cleared.
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').click();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toBe('');

    // Confirm the pending highlight is actually registered under
    // CSS.highlights before reading its color -- otherwise this assertion
    // could pass vacuously if PendingSelectionHighlight's registration
    // effect were removed while its <style jsx global> rule stayed behind,
    // since that rule is emitted unconditionally. Mirrors the equivalent
    // wait used for the saved-comment state below.
    await expect
      .poll(() =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment-pending')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    const composingColor = await getPseudoBackgroundColor(
      page,
      targetSentence,
      '::highlight(growi-inline-comment-pending)',
    );
    expect(composingColor).toBe(pendingColor);
    // Decisive assertion for the pending half of Requirement 1.5: selecting
    // and composing are both painted from the same pending token, so they
    // must still match EACH OTHER, even though the saved state below no
    // longer matches them.
    expect(selectingColor).toBe(composingColor);

    // --- State 3: saved (Req 1.1, 1.2) ---
    const commentText = 'a comment used to check the saved highlight color';
    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    // The saved highlight is drawn asynchronously, once AnchorResolver
    // re-resolves the just-created anchor against the rendered body (same
    // poll pattern as the reload test above).
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    const savedColor = await getPseudoBackgroundColor(
      page,
      targetSentence,
      '::highlight(growi-inline-comment)',
    );
    expect(savedColor).toBe(markerColor);

    // Decisive assertion (Req 1.1, 1.2): the saved color is genuinely
    // different from the pending color the range was painted with while
    // selecting/composing -- not merely each independently matching its own
    // token, but the two tokens resolving to two distinguishable colors.
    // (The OLD inline-comment-visual-consistency spec's Requirement 12.8
    // required all three states to share one identical color; this spec
    // retracts 12.8 specifically, while Requirement 1.5 keeps 12.4-12.7 --
    // theme-following, single-source-of-truth token, surviving focus moving
    // into the input -- intact, which is why those per-state assertions
    // above are unchanged.)
    expect(savedColor).not.toBe(composingColor);
  });
});

test.describe('Inline comment - highlight correctness on a page with an async lsx widget', () => {
  // Serial for the same reason as the suites above: the second test depends
  // on the comment created by the first, real backend state.
  test.describe.configure({ mode: 'serial' });

  const lsxPagePath = (retry: number) => `/inline-comment-e2e-lsx${retry}`;

  // `$lsx(depth=1)` is remark-lsx's directive syntax (see
  // packages/remark-lsx/src/client/services/renderer/lsx.ts) — a bare `$lsx(...)`
  // on its own line, with no explicit path attribute, lists the current page's
  // own children (packages/preset-templates' "displaying-child-pages" template
  // uses the identical form).
  //
  // The anchored quote is the child page's own basename — text that does not
  // exist ANYWHERE in the DOM until lsx's async fetch (useSWRxLsx, an
  // unconditional axios GET to /_api/lsx) resolves and `LsxListView` replaces
  // the loading placeholder with the real child list (`LsxPage.tsx` renders
  // the basename as the link's visible text). This is deliberately different
  // from anchoring on a static sentence sitting in its own paragraph: a quote
  // in a paragraph lsx never touches would still resolve correctly even if
  // settle detection were completely broken, because `resolveDomPosition`
  // recomputes the Range fresh against whatever DOM exists at match time — a
  // wrong-but-still-findable match isn't distinguishable from a correct one.
  // By contrast, quoting text that plainly does not exist pre-settle means
  // `matchQuote` must return `not_found` before lsx resolves and can only
  // succeed afterward — so this highlight can only ever come from a
  // recompute that happens at or after the real settle point (design.md's
  // `use-container-settle`), not from the settle-independent
  // anchors-content-change trigger racing ahead of it.
  const childBasename = 'AsyncLsxResolvedChildMarker';
  const pageBody = [
    '# Inline comment E2E - async lsx widget',
    '',
    'Some intro text before the lsx block.',
    '',
    '$lsx(depth=1)',
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;
  let createdChildPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    const pages = [createdPage, createdChildPage].filter(
      (p): p is CreatedPage => p != null,
    );
    if (pages.length > 0) {
      await deletePagesCompletely(request, pages);
    }
  });

  test('Create a page with a real lsx block, then comment on the child page name it renders', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: lsxPagePath(testInfo.retry),
      body: pageBody,
    });
    // The child page's basename IS the quoted text — it only appears in the
    // DOM once lsx's async fetch resolves and renders this child's link.
    createdChildPage = await createPage(request, {
      path: `${createdPage.path}/${childBasename}`,
      body: 'A child page whose basename is the inline comment anchor.',
    });

    await page.goto(createdPage.path);

    // Sanity: lsx actually rendered its child (not an error state) — otherwise
    // the "async round-trip with real content" premise of this test wouldn't
    // hold. LsxPage links render the child page's basename as their label
    // rather than its path (the href is the page's ObjectId), so match by
    // visible link text.
    await expect(
      page.locator('.wiki .lsx').getByRole('link', { name: childBasename }),
    ).toBeVisible();

    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, childBasename);

    // Requirement 2.1: the create action must be chosen before the form opens.
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      childBasename,
    );

    await form
      .locator('.cm-content')
      .fill('a comment anchored on the lsx-rendered child page name');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
  });

  test('After reloading with the lsx fetch artificially delayed, the highlight lands at the correct position only once lsx settles', async ({
    page,
  }, testInfo) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    // Delay `/_api/lsx` deterministically instead of relying on the fetch
    // happening to still be in flight when we check — a race would make this
    // test flaky in either direction (assert too early and it's a false
    // negative on a fast CI run; assert too late and it never observes the
    // pending state at all).
    const LSX_FETCH_DELAY_MS = 1500;
    await page.route('**/_api/lsx**', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, LSX_FETCH_DELAY_MS);
      });
      await route.continue();
    });

    await page.goto(lsxPagePath(testInfo.retry));

    const lsxContainer = page.locator('.wiki .lsx').first();
    await expect(lsxContainer).toBeAttached();

    // Confirm the delay is genuinely observed by the app: right after load,
    // lsx is still mid-fetch (the rendering-status attribute this feature's
    // settle detection watches — see `GROWI_IS_CONTENT_RENDERING_ATTR` in
    // design.md — is still "true").
    await expect(lsxContainer).toHaveAttribute(
      'data-growi-is-content-rendering',
      'true',
    );

    // Once the delayed fetch resolves, lsx flips the attribute to "false" —
    // the signal use-container-settle waits for before AnchorResolver
    // recomputes against the now-final DOM (Requirements 2.1/5.1).
    await expect(lsxContainer).toHaveAttribute(
      'data-growi-is-content-rendering',
      'false',
      { timeout: LSX_FETCH_DELAY_MS + 5_000 },
    );

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    // The decisive assertion: the highlighted range's text is exactly the
    // child page's basename — text that, per the fixture design above, did
    // not exist anywhere in the DOM until lsx settled. A highlight with this
    // exact text can only have been computed after lsx's real settle point,
    // not from the settle-independent anchors-content-change trigger (which
    // would have found `not_found` had it run against the pre-settle DOM).
    const highlightedText = await page.evaluate(() => {
      const set = CSS.highlights.get('growi-inline-comment');
      const range = set != null ? [...set][0] : undefined;
      return range?.toString();
    });
    expect(highlightedText).toBe(childBasename);
  });
});

test.describe('Inline comment - highlight lands on the selected occurrence on a page with a formula and a duplicated quote (Req 1.2, 1.3)', () => {
  // Serial for the same reason as the suites above: the second test depends on
  // the comment the first one really wrote to the backend.
  test.describe.configure({ mode: 'serial' });

  const mathPagePath = (retry: number) => `/inline-comment-e2e-math${retry}`;

  // The quote appears TWICE, and a KaTeX formula sits BEFORE both occurrences.
  // That arrangement is what makes this test decisive; the reasoning has two
  // legs.
  //
  // (1) The arithmetic. `matchExactly` (quote-matcher.ts) enumerates every
  //     exact occurrence and keeps the one whose start is closest to the stored
  //     `approxOffset`. Resolution counts offsets with `renderedTextOf`, which
  //     excludes `.katex` subtrees (KaTeX renders both an accessibility-only
  //     `.katex-mathml` tree and a visual `.katex-html` tree, so a naive
  //     `textContent` read counts the formula's characters two to three times
  //     over). Before this feature's fix, capture time read the container's raw
  //     `textContent` instead, so the stored offset was inflated by K — the
  //     total length of the `.katex` text preceding the selection. Writing o1
  //     and o2 for the two occurrences' offsets in the excluded-text
  //     coordinates and d = o2 - o1:
  //       - fixed code   stores o1        → nearest occurrence is o1 (distance 0)
  //       - broken code  stores o1 + K    → distance to o1 is K, to o2 is |d - K|
  //     so the broken value picks the WRONG (second) occurrence exactly when
  //     d < 2K. The `expect(2 * katexTextLength).toBeGreaterThan(d)` precondition
  //     below asserts that inequality against the page as the browser really
  //     rendered it, so the fixture can never go quietly vacuous (if the math
  //     failed to render, K would be 0 and both code paths would agree).
  //     Note the direction matters: the inflation only ever moves the stored
  //     offset FORWARD, so the target has to be the EARLIER occurrence with the
  //     formula in front of it. Commenting on the later occurrence would be
  //     unfalsifiable — no shift could ever pull the match backwards.
  //
  // (2) Nothing else could rescue the right answer. `matchExactly` disambiguates
  //     on `approxOffset` alone, and `matchApproximately`'s own doc comment
  //     records that it deliberately ignores `prefix`/`suffix`. The two
  //     occurrences' differing surrounding sentences therefore give the resolver
  //     no signal whatsoever — the stored offset is the only thing that can tell
  //     the two apart. This mirrors the lsx suite above, where the quote simply
  //     does not exist pre-settle: a pass cannot be reached by accident.
  const duplicatedQuote = 'the very same phrase appears twice';
  const pageBody = [
    '# Inline comment E2E - duplicate quote after a formula',
    '',
    '$$',
    '\\int_{0}^{\\infty} \\frac{\\sin x}{x}\\,dx = \\frac{\\pi}{2}',
    '$$',
    '',
    `First occurrence marker: ${duplicatedQuote}.`,
    '',
    `Second occurrence marker: ${duplicatedQuote}.`,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create the page, then comment on the FIRST of the two identical phrases that follow the formula', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: mathPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);

    // The formula must actually be rendered by KaTeX. `rehype-katex` runs in
    // the view renderer's synchronous plugin chain (client/services/renderer),
    // so this is not a timing wait — it is a guard so a silent math-render
    // failure fails loudly here instead of turning the whole test vacuous.
    await expect(page.locator('.wiki .katex').first()).toBeVisible();
    await expect(page.locator('.wiki').first()).toContainText(
      `Second occurrence marker: ${duplicatedQuote}`,
    );

    // Fixture validity, measured on the real DOM rather than assumed — see
    // leg (1) of the reasoning above. `d` is read off the naive `textContent`
    // deliberately: no excluded subtree sits BETWEEN the two occurrences, so
    // the gap is identical in both counting schemes. `katexTextLength` is a
    // lower bound on the capture/resolution delta the old code produced (any
    // `aria-hidden` decorative text before the quote would only add to it),
    // and the `d < 2K` condition is monotone in that delta, so using the bound
    // keeps the precondition conservative.
    const { katexTextLength, d } = await page.evaluate((quote) => {
      const container = document.querySelector('.wiki');
      if (container == null) {
        throw new Error('page body container (.wiki) not found');
      }
      const text = container.textContent ?? '';
      const first = text.indexOf(quote);
      const second = text.indexOf(quote, first + 1);
      const katexTextLength = [...container.querySelectorAll('.katex')].reduce(
        (total, el) => total + (el.textContent?.length ?? 0),
        0,
      );
      return { katexTextLength, d: second - first };
    }, duplicatedQuote);

    expect(katexTextLength).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
    expect(2 * katexTextLength).toBeGreaterThan(d);

    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // `selectTextInPageBody` walks the body's text nodes in document order and
    // selects the first match, i.e. the occurrence in the "First occurrence
    // marker" paragraph — the earlier of the two, which is the one the
    // arithmetic above makes discriminating.
    await selectTextInPageBody(page, duplicatedQuote);

    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      duplicatedQuote,
    );

    await form
      .locator('.cm-content')
      .fill('a comment anchored on the first of two identical phrases');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    await expect(page.getByTestId('inline-comment-item').first()).toBeVisible();
  });

  test('After reloading, the restored highlight sits on the first occurrence, not the second (Req 1.2, 1.3)', async ({
    page,
  }, testInfo) => {
    await page.goto(mathPagePath(testInfo.retry));

    await expect(page.locator('.wiki .katex').first()).toBeVisible();
    await expect(page.getByTestId('inline-comment-item').first()).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    const highlighted = await page.evaluate(() => {
      const set = CSS.highlights.get('growi-inline-comment');
      const range = set != null ? [...set][0] : undefined;
      if (range == null) {
        return null;
      }
      const { startContainer } = range;
      const startElement =
        startContainer.nodeType === Node.TEXT_NODE
          ? startContainer.parentElement
          : (startContainer as Element);
      return {
        text: range.toString(),
        paragraphText: startElement?.closest('p')?.textContent ?? null,
      };
    });

    // The exact quote (not a fuzzy near-miss): proves the exact-match path,
    // whose only occurrence tie-breaker is the stored offset.
    expect(highlighted?.text).toBe(duplicatedQuote);
    // The decisive assertion: the highlight is anchored inside the paragraph
    // holding the FIRST occurrence — the one that was actually selected — and
    // not inside the paragraph holding the identical second occurrence.
    expect(highlighted?.paragraphText).toContain('First occurrence marker');
    expect(highlighted?.paragraphText).not.toContain(
      'Second occurrence marker',
    );
  });
});

test.describe('Inline comment - shares one list and one box style with normal comments (Req 13.1-13.4, 13.9)', () => {
  // Serial: each test below posts one more comment on top of what the
  // previous test posted, and the final test reads the accumulated state --
  // the same reasoning the other suites in this file use for serial mode.
  test.describe.configure({ mode: 'serial' });

  const mixedListPagePath = (retry: number) =>
    `/inline-comment-e2e-mixed-list${retry}`;

  const targetSentence =
    'This sentence anchors the mixed-comment-list end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - mixed comment list',
    '',
    targetSentence,
    '',
  ].join('\n');

  // Ordering matters here: "before" posted first, the inline comment second,
  // "after" third. Requirement 13.1/13.2 asks for the merged list to be
  // ordered by posting date, not grouped by kind -- a broken merge that
  // appended one kind after the other would put the inline comment first or
  // last instead of in the middle, so these three texts (and their expected
  // middle position for the inline one) are the decisive fixture.
  const normalCommentBeforeText =
    'a normal comment posted before the inline one';
  const inlineCommentText =
    'an inline comment posted between two normal comments';
  const normalCommentAfterText = 'a normal comment posted after the inline one';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: mixedListPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Post a normal (page-bottom) comment first', async ({
    page,
  }, testInfo) => {
    await page.goto(mixedListPagePath(testInfo.retry));

    // Same page-bottom comment flow as `20-basic-features/comments.spec.ts`.
    await page.getByTestId('page-comment-button').click();
    await page.getByTestId('open-comment-editor-button').click();
    await page.locator('.cm-content').fill(normalCommentBeforeText);
    await page.getByTestId('comment-submit-button').first().click();

    await expect(page.locator('.page-comment-body')).toContainText(
      normalCommentBeforeText,
    );
  });

  test('Post an inline comment second', async ({ page }, testInfo) => {
    await page.goto(mixedListPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(inlineCommentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(inlineCommentText);
  });

  test('Post a second normal comment third', async ({ page }, testInfo) => {
    await page.goto(mixedListPagePath(testInfo.retry));

    await page.getByTestId('page-comment-button').click();
    await page.getByTestId('open-comment-editor-button').click();
    await page.locator('.cm-content').fill(normalCommentAfterText);
    await page.getByTestId('comment-submit-button').first().click();

    await expect(page.locator('.page-comment-body').last()).toContainText(
      normalCommentAfterText,
    );
  });

  test('The three comments sit in one list, ordered by posting date, and the normal/inline items share the exact same box styling', async ({
    page,
  }, testInfo) => {
    await page.goto(mixedListPagePath(testInfo.retry));

    // Requirement 13.1: one list -- the single container `PageComment.tsx`
    // renders both kinds into (design.md 決定3). Scoped via the `.page-comments`
    // wrapper class, not `#page-comments-list` alone: `Comments.tsx`'s own
    // outer wrapper (a pre-existing, out-of-boundary issue unrelated to this
    // task) reuses the exact same id on a different element, so an id-only
    // locator would silently match both elements' children combined.
    const listItems = page.locator(
      '.page-comments > #page-comments-list > div',
    );
    await expect(listItems).toHaveCount(3);

    // Requirement 13.2: ordered by posting date, not by kind. If the merge
    // were grouped by type instead of interleaved (e.g. the pre-amend
    // `[...comments].reverse()` that never merged inline comments in at
    // all, or a broken merge that appended one kind after the other), the
    // inline comment would not land in the middle position.
    await expect(listItems.nth(0)).toContainText(normalCommentBeforeText);
    await expect(listItems.nth(1)).toContainText(inlineCommentText);
    await expect(listItems.nth(2)).toContainText(normalCommentAfterText);

    // Confirm the middle item is genuinely the inline one (not merely a
    // normal comment whose text happens to overlap), and that the other two
    // are not.
    await expect(
      listItems.nth(1).getByTestId('inline-comment-item'),
    ).toBeVisible();
    await expect(
      listItems.nth(0).getByTestId('inline-comment-item'),
    ).toHaveCount(0);
    await expect(
      listItems.nth(2).getByTestId('inline-comment-item'),
    ).toHaveCount(0);

    // Requirement 13.3/13.4: both kinds render through the shared
    // `CommentCard` (design.md 決定2), so the box each one paints --
    // `.page-comment-main.bg-comment.rounded` -- must resolve to the exact
    // same computed style, not merely a similar-looking one.
    const readBoxStyle = (locator: ReturnType<Page['locator']>) =>
      locator.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderStyle: style.borderStyle,
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
        };
      });

    const normalBox = listItems
      .nth(0)
      .locator('.page-comment-main.bg-comment.rounded');
    const inlineBox = listItems
      .nth(1)
      .locator('.page-comment-main.bg-comment.rounded');

    const normalBoxStyle = await readBoxStyle(normalBox);
    const inlineBoxStyle = await readBoxStyle(inlineBox);
    expect(inlineBoxStyle).toEqual(normalBoxStyle);

    // Sanity: the box actually paints something distinguishable, ruling out
    // the comparison above passing vacuously because neither side has any
    // rounding/background at all.
    expect(normalBoxStyle.borderRadius).not.toBe('0px');
  });
});

test.describe('Inline comment - a new selection overlapping a saved comment stays distinguishable (Req 1.1, 1.2)', () => {
  // Serial: the second test depends on the saved comment created by the
  // first, real backend state -- the same reasoning the other suites in this
  // file use.
  test.describe.configure({ mode: 'serial' });

  const overlapPagePath = (retry: number) =>
    `/inline-comment-e2e-overlap${retry}`;

  const targetSentence =
    'This sentence anchors the overlapping-highlight end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - overlapping highlights',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * Local copy of the same-named helper in the "highlight color stays the
   * same across states" suite above -- kept scoped to this describe block
   * (not hoisted to module scope) to match that suite's own precedent: it,
   * too, keeps its pseudo-color reader local to its block rather than
   * sharing it across suites.
   */
  const getPseudoBackgroundColor = (
    targetPage: Page,
    text: string,
    pseudo: string,
  ): Promise<string> =>
    targetPage.evaluate(
      ({ needle, pseudoSelector }) => {
        const container = document.querySelector('.wiki');
        if (container == null) {
          throw new Error('page body container (.wiki) not found');
        }
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let node = walker.nextNode();
        while (node != null) {
          if (node.textContent?.includes(needle)) {
            const el = node.parentElement;
            if (el == null) {
              throw new Error('matched text node has no parent element');
            }
            return window.getComputedStyle(el, pseudoSelector).backgroundColor;
          }
          node = walker.nextNode();
        }
        throw new Error(`text not found in page body: ${needle}`);
      },
      { needle: text, pseudoSelector: pseudo },
    );

  /**
   * Resolves the saved-comment token (`--grw-inline-comment-marker-bg`) to a
   * computed color via a throwaway probe element, the same technique the
   * "highlight consistency across states" suite above uses for the identical
   * purpose -- kept as its own local copy rather than shared, per that
   * suite's own precedent.
   */
  const readSavedMarkerColor = (targetPage: Page): Promise<string> =>
    targetPage.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--grw-inline-comment-marker-bg)';
      document.body.appendChild(probe);
      const color = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });

  /**
   * Resolves the *applied* (already semi-transparent) pending-highlight
   * value to a computed color, via the exact same `color-mix()` expression
   * `PendingSelectionHighlight.tsx` uses for its `::selection` /
   * `::highlight(growi-inline-comment-pending)` rules (design.md decision 1:
   * "適用箇所は半透明にする" -- `color-mix(in srgb,
   * var(--grw-inline-comment-marker-bg-pending) 70%, transparent)`). Mirroring
   * the production expression here (rather than reading the raw
   * `--grw-inline-comment-marker-bg-pending` token alone) is what proves the
   * two highlight-origins resolve to genuinely different painted values, not
   * just different token names.
   */
  const readPendingAppliedColor = (targetPage: Page): Promise<string> =>
    targetPage.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor =
        'color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending) 70%, transparent)';
      document.body.appendChild(probe);
      const color = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: overlapPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Selecting text over an already-saved comment shows both highlights at once, painted with different colors', async ({
    page,
  }, testInfo) => {
    await page.goto(overlapPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // --- Step 1: save a comment on the target sentence first. ---
    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    const commentText = 'a saved comment that a later selection overlaps';
    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    // The saved highlight is registered asynchronously, once AnchorResolver
    // resolves the just-created anchor against the rendered body (same poll
    // pattern used throughout this file).
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    // --- Step 2: make a NEW selection overlapping the same, already-saved
    // range (design.md's "本文選択の監視" / Req 1.2's overlapping-selection
    // case). Selecting the same sentence again is a straightforward,
    // guaranteed-overlapping choice: `selectTextInPageBody` already supports
    // selecting by exact text content. Merely selecting (no click on the
    // action button yet) is enough to register the pending highlight --
    // SelectionCapture renders `PendingSelectionHighlight` with
    // `range={state.liveRange}` as soon as it reaches the `selecting` stage,
    // the same "Requirement 12.4: same marker color while merely selecting"
    // state the highlight-consistency suite above exercises. ---
    await selectTextInPageBody(page, targetSentence);
    await expect(page.getByTestId('selection-action-button')).toBeVisible();

    // Requirement 1.2, decisive proof of "both shown at once": both the
    // saved highlight and the new pending highlight are simultaneously
    // registered under CSS.highlights -- not merely "a different color
    // exists somewhere", but both actively painting the same overlapping
    // range right now.
    await expect
      .poll(() =>
        page.evaluate(() => ({
          saved: CSS.highlights.get('growi-inline-comment')?.size ?? 0,
          pending:
            CSS.highlights.get('growi-inline-comment-pending')?.size ?? 0,
        })),
      )
      .toEqual({ saved: 1, pending: 1 });

    // Requirement 1.1: the two highlight-origins resolve to different raw
    // colors -- the saved token stays opaque, while the pending token's
    // applied value is composited semi-transparent (design.md decision 1).
    const savedMarkerColor = await readSavedMarkerColor(page);
    const pendingAppliedColor = await readPendingAppliedColor(page);
    // Sanity: neither resolves to fully transparent, which would make every
    // comparison below pass vacuously.
    expect(savedMarkerColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(pendingAppliedColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(pendingAppliedColor).not.toBe(savedMarkerColor);

    // Strongest, most direct proof: read what is actually painted on the
    // overlapping text at this exact moment, for both pseudo forms at once.
    // A real document selection exists right now, so CSS's own
    // highlight-painting order (`::highlight() < ::selection`, design.md
    // decision 1) puts `::selection` on top -- it must resolve to the
    // composited pending color. The saved highlight is still registered
    // underneath (confirmed above), and its own pseudo resolves to the
    // opaque saved color independently of what currently paints on top.
    const topPaintedColor = await getPseudoBackgroundColor(
      page,
      targetSentence,
      '::selection',
    );
    const savedHighlightColor = await getPseudoBackgroundColor(
      page,
      targetSentence,
      '::highlight(growi-inline-comment)',
    );
    expect(topPaintedColor).toBe(pendingAppliedColor);
    expect(savedHighlightColor).toBe(savedMarkerColor);
    expect(topPaintedColor).not.toBe(savedHighlightColor);
  });
});

test.describe('Inline comment - hover/click/tap on a saved body highlight opens a preview popover with simple reply (Req 2.1-2.5)', () => {
  // Serial: every test in this suite reuses the one saved comment created by
  // the first test, the same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const bodyPopoverPagePath = (retry: number) =>
    `/inline-comment-e2e-body-popover${retry}`;

  const targetSentence =
    'This sentence anchors the body-popover end-to-end test.';
  const introText = 'Some intro text before the target, hovered to move away.';
  const pageBody = [
    '# Inline comment E2E - body popover',
    '',
    introText,
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

  const commentText = 'a comment surfaced through the body popover';

  test('Create a page and save an inline comment on the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: bodyPopoverPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    // The saved highlight (and therefore its hit-testable Range) is only
    // registered once AnchorResolver resolves the just-created anchor -- same
    // poll pattern used throughout this file.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Desktop: hovering the highlight shows the comment content, and moving away closes it (Req 2.1, 2.4, 2.5)', async ({
    page,
  }, testInfo) => {
    // The default viewport (1400x1024, playwright.config.ts) is well above
    // Bootstrap's `md` breakpoint (768px) -- the desktop case Req 2.1 covers.
    await page.goto(bodyPopoverPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).not.toBeVisible();

    await hoverText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);

    // Requirement 15, AC 15.5: the popover also offers an edit control for
    // the origin comment's own body (to its own author), in addition to its
    // reply composer -- covered by the "Edit flow" suite below, so this test
    // only checks the reply composer. 2026-09-11 その4: the composer is
    // `MentionAwareCommentInput` (a CodeMirror `.cm-content` editor), not a
    // plain `<textarea>`.
    await expect(popover.locator('.cm-content')).toHaveCount(1);

    // Requirement 2.4 (hover case): moving the mouse to an unrelated part of
    // the body (not merely off-screen, so the pointer's target is still
    // inside the body container and the hit test actually re-runs) drops the
    // hover-only hit, and with nothing pinning it, the popover closes.
    await hoverText(page, introText);
    await expect(popover).not.toBeVisible();
  });

  test('Desktop: clicking the highlight opens and pins the popover, which stays open once the mouse moves away (Req 2.1)', async ({
    page,
  }, testInfo) => {
    await page.goto(bodyPopoverPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);

    // Decisive proof of "pinned": a plain hover elsewhere, which alone closes
    // a hover-only popover (proven in the previous test), does NOT close a
    // click-pinned one.
    await hoverText(page, introText);
    await expect(popover).toBeVisible();

    // Requirement 2.4: the popover's own explicit close control still works
    // on a pinned popover.
    await popover.getByRole('button', { name: 'Close' }).click();
    await expect(popover).not.toBeVisible();
  });

  test('Requirement 2.4: clicking outside the popover closes it', async ({
    page,
  }, testInfo) => {
    await page.goto(bodyPopoverPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();

    await clickText(page, introText);
    await expect(popover).not.toBeVisible();
  });

  test('Requirement 2.3: submitting a reply from the popover posts it, and it appears nested under the origin item in the bottom list', async ({
    page,
  }, testInfo) => {
    await page.goto(bodyPopoverPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();

    const replyText = 'a reply posted through the body popover';
    // 2026-09-11 その4: the popover's reply composer is `MentionAwareCommentInput`
    // (a CodeMirror `.cm-content` editor, same as everywhere else in this
    // file), not the plain textarea it used to be -- driven the same way.
    await popover.locator('.cm-content').fill(replyText);
    await popover.getByRole('button', { name: 'Commment' }).click();

    // The popover clears its draft and keeps itself open on a successful
    // submit (InlineCommentPreviewPopover.tsx has no self-close-on-submit
    // behavior); the decisive proof is the bottom-of-page list, the single
    // source of truth `createReply` writes to either way (design.md 決定2:
    // this popover calls the exact same `createReply` prop `PageView.tsx`
    // wires into the bottom list).
    await expect(popover.locator('.cm-content')).not.toContainText(replyText);

    const item = page.getByTestId('inline-comment-item').first();
    const reply = item.getByTestId('inline-comment-reply').last();
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(replyText);
  });

  test('Tablet-and-below: tapping the highlight opens the popover (Req 2.2)', async ({
    page,
  }, testInfo) => {
    // 600px is at/below Bootstrap's `md` breakpoint (768px) -- the same
    // narrow width `sticky-features.spec.ts` uses for its own tablet/mobile
    // check. A tap and a mouse click dispatch the same `click` event in a
    // real browser, and `useHighlightHitTest` treats tablet-and-below width
    // as click-only (its `pointermove`/hover branch is desktop-only), so a
    // plain `.click()` at this viewport width IS the tap interaction under
    // test here -- no separate touch-emulation API is required.
    await page.setViewportSize({ width: 600, height: 1024 });
    await page.goto(bodyPopoverPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).not.toBeVisible();

    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);
  });
});

test.describe('Inline comment - hover-to-popover transit and popover-lock timing (Req 15.7-15.9); resolve from the popover and click-path regression (Req 15.10, 4.6)', () => {
  // Serial: every test in this suite reuses the one saved comment created by
  // the first test (same reasoning the other suites in this file use). The
  // resolve test is placed last because it's the only one that mutates the
  // comment's resolved state, so it can't run before the others without
  // affecting their expectations.
  test.describe.configure({ mode: 'serial' });

  const popoverRefinementPagePath = (retry: number) =>
    `/inline-comment-e2e-popover-refinement${retry}`;

  const targetSentence =
    'This sentence anchors the popover-refinement end-to-end test.';
  const introText =
    'Some intro text before the target, used as a neutral point.';
  const pageBody = [
    '# Inline comment E2E - popover refinement',
    '',
    introText,
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

  const commentText = 'a comment surfaced through the refined body popover';

  test('Create a page and save an inline comment on the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: popoverRefinementPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    // The saved highlight (and therefore its hit-testable Range) is only
    // registered once AnchorResolver resolves the just-created anchor -- same
    // poll pattern used throughout this file.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 15.7-15.9: moving the pointer from the highlight, through the gap, and onto the popover keeps it visible throughout, and once landed it stays open even after the pointer leaves entirely', async ({
    page,
  }, testInfo) => {
    await page.goto(popoverRefinementPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).not.toBeVisible();

    const highlightPoint = await centerOfText(page, targetSentence);
    await page.mouse.move(highlightPoint.x, highlightPoint.y);

    // Req 15.7: appears after the show delay -- the default expect timeout
    // comfortably covers the 150ms delay, so no fixed wait is needed here.
    await expect(popover).toBeVisible();

    const popoverBox = await popover.boundingBox();
    if (popoverBox == null) {
      throw new Error('popover has no bounding box');
    }
    const popoverCenter = {
      x: popoverBox.x + popoverBox.width / 2,
      y: popoverBox.y + popoverBox.height / 2,
    };
    const midpoint = {
      x: (highlightPoint.x + popoverCenter.x) / 2,
      y: (highlightPoint.y + popoverCenter.y) / 2,
    };

    // Req 15.8/15.9: a real multi-step transit (not an instant jump / a plain
    // `.hover()`) through the gap between the highlight and the popover --
    // this is the exact regression this spec fixes. A single instant jump
    // would never actually pass through the gap, where the hit test used to
    // report "no hit" and close the popover before the pointer arrived.
    await page.mouse.move(midpoint.x, midpoint.y, { steps: 10 });
    // Still visible mid-transit, before reaching the popover -- proven by
    // the hide-delay grace period (Req 15.8/15.9), not by luck.
    await expect(popover).toBeVisible();

    await page.mouse.move(popoverCenter.x, popoverCenter.y, { steps: 10 });
    await expect(popover).toBeVisible();

    // Req 15.9: the pointer has now entered the popover's own DOM, which
    // promotes it to the same "pinned" state a click uses. Moving away
    // entirely (off both the highlight and the popover) must not close it.
    await hoverText(page, introText);

    // Deliberate real-time wait: proving nothing auto-closes the popover
    // requires observing that it stays visible across a window longer than
    // both the show delay (150ms) and the hide delay (250ms) combined --
    // there is no assertion-based substitute for "this stays true for at
    // least N ms".
    await page.waitForTimeout(500);
    await expect(popover).toBeVisible();

    // Sanity check: the popover can still be closed at all, via an explicit
    // outside click (Req 15.9's "until an explicit close").
    await clickText(page, introText);
    await expect(popover).not.toBeVisible();
  });

  test('Req 15.1, 15.4: clicking the highlight still opens the popover immediately, with no visible delay, and it stays open with no further interaction', async ({
    page,
  }, testInfo) => {
    await page.goto(popoverRefinementPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).not.toBeVisible();

    await clickText(page, targetSentence);

    // A short explicit timeout, well under the 150ms hover show-delay, proves
    // the click path genuinely bypasses that debounce rather than merely
    // happening to resolve within the default 5s expect timeout.
    await expect(popover).toBeVisible({ timeout: 100 });
    await expect(popover).toContainText(commentText);

    // No further interaction (no hover, no pointer move) -- confirms no
    // accidental auto-hide behavior leaked into the click path.
    await page.waitForTimeout(500);
    await expect(popover).toBeVisible();
  });

  test('Req 15.10, 15.12, 4.6: resolving the comment from the popover closes the popover (no status badge is shown there -- Req 15.13) and updates the badge shown in the bottom-of-page list for the same comment', async ({
    page,
  }, testInfo) => {
    await page.goto(popoverRefinementPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();

    await popover.getByRole('button', { name: 'Resolve' }).click();

    // Req 15.12: the popover auto-closes once its own comment becomes
    // resolved -- there is no status badge inside it to assert against
    // (Req 15.13, task 6 removed that markup from the popover entirely).
    await expect(popover).not.toBeVisible();

    // Cross-surface consistency: the same comment's badge in the
    // bottom-of-page list (`InlineCommentItem.tsx`, a structurally different
    // component from the popover) must reflect the same resolved state --
    // proving the resolve reaches the shared SWR source of truth, not just
    // the popover's own local state.
    const item = page.getByTestId('inline-comment-item').first();
    const itemStatus = item.getByTestId('inline-comment-status');
    await expect(itemStatus).toHaveText('Resolved');
  });
});

test.describe('Inline comment - a re-anchor-failed comment never surfaces a body popover (Req 2.6)', () => {
  // Serial: the second test depends on the comment created by the first, and
  // deliberately breaks that same comment's anchor -- the same reasoning the
  // "best-effort fallback" suite above uses for its own two-test structure.
  test.describe.configure({ mode: 'serial' });

  const notFoundPopoverPagePath = (retry: number) =>
    `/inline-comment-e2e-popover-not-found${retry}`;

  // Same fixture shape as the "best-effort fallback" suite above: long enough
  // that the fuzzy matcher's tolerance cannot bridge the gap to its
  // replacement, so the anchor is deterministically `not_found` after the edit.
  const targetSentence =
    'This sentence anchors a comment whose target will be removed so the popover has nothing left to hit-test against.';
  const replacementSentence = 'Unrelated replacement text.';
  const pageBody = [
    '# Inline comment E2E - popover not-found anchor',
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

  test('Create a page, then save an inline comment on the sentence that will later be removed', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: notFoundPopoverPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form
      .locator('.cm-content')
      .fill('a comment whose target will be removed');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('After the commented-on text is edited away and the page reloads, hovering/clicking where it used to be shows no popover (Req 2.6)', async ({
    page,
    request,
  }) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    const editedBody = pageBody.replace(targetSentence, replacementSentence);
    createdPage = await updatePage(request, createdPage, editedBody);

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(
      replacementSentence,
    );
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // Requirement 2.6: the anchor could not be re-resolved (`not_found`), so
    // `rangesById()` never produces a Range for it (design.md 決定2/決定3) --
    // there is nothing left in the body to hit-test against. Confirm this
    // precondition first (no highlight drawn at all), then confirm hovering
    // and clicking the text that replaced it still surfaces no popover.
    expect(
      await page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      ),
    ).toBe(0);

    const popover = page.getByTestId('inline-comment-preview-popover');
    const replacementElement = page
      .locator('.wiki')
      .getByText(replacementSentence, { exact: true });

    await replacementElement.hover();
    await expect(popover).not.toBeVisible();

    await replacementElement.click();
    await expect(popover).not.toBeVisible();
  });
});

test.describe('Inline comment - clicking a list item scrolls to and emphasizes the anchored body range, or notifies on a re-anchor failure (Req 3.1-3.3)', () => {
  // Serial: the scroll test depends on the comment saved by the first test,
  // and the later re-anchor-failure tests deliberately break that same
  // comment's anchor afterward — same reasoning the other multi-step suites
  // in this file use.
  test.describe.configure({ mode: 'serial' });

  const scrollNavPagePath = (retry: number) =>
    `/inline-comment-e2e-scroll-nav${retry}`;

  const targetSentence =
    'This sentence anchors the scroll-navigation end-to-end test, placed well below the initial viewport fold.';
  const replacementSentence =
    'Unrelated replacement text that stands in for the removed target sentence.';

  // Enough filler paragraphs that the target starts below the initial
  // viewport fold on a fresh load (default viewport is 1400x1024,
  // playwright.config.ts) — same technique as the "action button lifecycle"
  // suite above.
  const fillerParagraphs = Array.from(
    { length: 20 },
    (_, i) =>
      `Filler paragraph ${i} pushes the target sentence well below the initial viewport fold.`,
  );
  const pageBody = [
    '# Inline comment E2E - scroll navigation',
    '',
    ...fillerParagraphs.flatMap((paragraph) => [paragraph, '']),
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

  const commentText = 'a comment used to test list-to-body scroll navigation';

  test('Create a page and save an inline comment on a target sentence placed well below the initial viewport fold', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: scrollNavPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    // The saved highlight (and therefore its hit-testable Range, which
    // `scrollToRange` also relies on via `rangesById()`) is only registered
    // once AnchorResolver resolves the just-created anchor — same poll
    // pattern used throughout this file.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 3.1, 3.3: clicking the list item scrolls the target sentence into view and applies a temporary emphasis highlight that clears after ~2s', async ({
    page,
  }, testInfo) => {
    await page.goto(scrollNavPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const viewportSize = page.viewportSize();
    const viewportHeight = viewportSize?.height ?? 1024;
    const targetLocator = page
      .locator('.wiki')
      .getByText(targetSentence, { exact: true });

    // Precondition: on a fresh load the page is scrolled to the top, and the
    // target sentence — pushed down by the filler paragraphs — starts below
    // the fold. `boundingBox()` reports viewport-relative coordinates
    // regardless of whether the element is actually within the viewport (the
    // "action button lifecycle" suite above relies on the same fact), so
    // this is the "before" half of the proof that the click below causes a
    // real scroll rather than the target already being on-screen.
    const beforeBox = await targetLocator.boundingBox();
    if (beforeBox == null) {
      throw new Error('expected a bounding box for the target sentence');
    }
    expect(beforeBox.y).toBeGreaterThan(viewportHeight);

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    // The quote button has no dedicated testid (InlineCommentItem.tsx wraps
    // the `.inline-comment-quote` blockquote in a plain `<button>`) — located
    // via its role and the anchored quote text, which distinguishes it from
    // the item's other buttons (resolve toggle, reply).
    const quoteButton = item
      .getByRole('button')
      .filter({ hasText: targetSentence });

    const emphasisHighlightSize = () =>
      page.evaluate(
        () => CSS.highlights.get('growi-inline-comment-emphasis')?.size ?? 0,
      );
    expect(await emphasisHighlightSize()).toBe(0);

    await quoteButton.click();

    // Requirement 3.1: the click scrolls the body so the target sentence
    // ends up inside the viewport. `scrollIntoView({ behavior: 'smooth' })`
    // animates over time, so this is polled rather than asserted once.
    await expect
      .poll(
        async () => {
          const box = await targetLocator.boundingBox();
          return box == null ? Infinity : box.y;
        },
        { timeout: 5000 },
      )
      .toBeLessThan(viewportHeight);

    const afterBox = await targetLocator.boundingBox();
    if (afterBox == null) {
      throw new Error('expected a bounding box for the target sentence');
    }
    expect(afterBox.y).toBeGreaterThan(0);

    // Requirement 3.3: a temporary emphasis highlight (a distinct CSS
    // highlight name from the persistent saved-comment one) registers on the
    // scrolled-to range, and PageView.tsx's own emphasis timer (2000ms)
    // clears it again shortly after — polled on both ends rather than a
    // single `waitForTimeout(2000)` immediately followed by an assertion, to
    // avoid racing that timer. The clear-side timeout is generously wider
    // than the 2000ms production timer, since the `setTimeout` can fire late
    // under a loaded CI/dev machine without that meaning the behavior itself
    // is broken.
    await expect.poll(emphasisHighlightSize).toBeGreaterThan(0);
    await expect.poll(emphasisHighlightSize, { timeout: 10000 }).toBe(0);
  });

  test('Req 3.2 setup: after the anchored text is edited away and the page reloads, the saved highlight is not restored', async ({
    page,
    request,
  }) => {
    if (createdPage == null) {
      throw new Error('createdPage was not set by the previous test');
    }

    const editedBody = pageBody.replace(targetSentence, replacementSentence);
    createdPage = await updatePage(request, createdPage, editedBody);

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(
      replacementSentence,
    );
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // Same "best-effort fallback" precondition used elsewhere in this file:
    // the anchor could not be re-resolved, so no saved highlight is drawn —
    // confirming `scrollToRange`'s target Range genuinely does not exist
    // before the next test tries to click it.
    expect(
      await page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      ),
    ).toBe(0);
  });

  test('Req 3.2: clicking the list item for a re-anchor-failed comment shows a notification and does not scroll or emphasize anything', async ({
    page,
  }, testInfo) => {
    await page.goto(scrollNavPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // The list item itself survives (design.md 決定4: a resolver failure only
    // means `rangesById()` produces no Range for this id) — its quote still
    // shows the ORIGINAL anchor text, since that is the stored anchor quote,
    // not the page's current (edited) content.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    const quoteButton = item
      .getByRole('button')
      .filter({ hasText: targetSentence });

    await expect(page.locator('.Toastify__toast')).not.toBeVisible();
    await quoteButton.click();

    // Requirement 3.2: no Range resolves for this comment id, so
    // `scrollToRange` reports failure through the existing notification UI
    // instead of scrolling.
    await expect(page.locator('.Toastify__toast')).toBeVisible();
    await expect(page.locator('.Toastify__toast')).toContainText(
      'could not be found',
    );

    // ...and neither of the two things a successful call does happens: no
    // temporary emphasis highlight is ever registered — the decisive proof
    // that no scroll/emphasis branch ran at all (unlike `window.scrollY`,
    // this is not confounded by Playwright's own scroll-into-view-to-click
    // behavior on the list item).
    expect(
      await page.evaluate(
        () => CSS.highlights.get('growi-inline-comment-emphasis')?.size ?? 0,
      ),
    ).toBe(0);
  });
});

test.describe('Inline comment - the bottom-list reply UI is unified with the normal comment reply UI (Req 4.1-4.5)', () => {
  // Serial: every test in this suite reuses the one saved inline comment
  // created by the first test, and the final test's actual submit builds on
  // the toggle-open/cancel state the middle tests exercise first — the same
  // reasoning the other suites in this file use for serial mode.
  test.describe.configure({ mode: 'serial' });

  const unifiedReplyPagePath = (retry: number) =>
    `/inline-comment-e2e-unified-reply${retry}`;

  const targetSentence =
    'This sentence anchors the unified-reply-UI end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - unified reply UI',
    '',
    targetSentence,
    '',
  ].join('\n');

  const originCommentText =
    'an origin comment used for the unified-reply-UI test';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and save an inline comment on the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: unifiedReplyPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(originCommentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(originCommentText);
  });

  test('Req 4.1, 4.4: before opening, the list item shows only the "Reply..." toggle button, not an always-visible textarea', async ({
    page,
  }, testInfo) => {
    await page.goto(unifiedReplyPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // Requirement 4.1: the same wording ("Reply..." -- `t('page_comment.reply')`
    // plus a literal "...", InlineCommentReplies.tsx) and the same testid/class
    // combination (`inline-comment-reply-toggle-button`,
    // `btn btn-secondary btn-comment-reply`) PageComment.tsx's own normal-comment
    // reply toggle uses.
    const toggleButton = item.getByTestId('inline-comment-reply-toggle-button');
    await expect(toggleButton).toBeVisible();
    // `toContainText` rather than `toHaveText`: the button's rendered text
    // content also includes the material-symbols ligature text ("reply")
    // from its icon <span>, ahead of the visible "Reply..." label -- an
    // implementation detail of the icon font, not part of the wording this
    // requirement is about.
    await expect(toggleButton).toContainText('Reply...');
    await expect(toggleButton).toHaveClass(/btn-comment-reply/);

    // Requirement 4.4: the old always-visible plain-textarea reply UI is gone
    // -- no bare `<textarea>` exists anywhere in this item before the toggle
    // is clicked (the mention-aware editor below is a CodeMirror `.cm-content`
    // div, never a `<textarea>`).
    await expect(item.locator('textarea')).toHaveCount(0);
    await expect(item.locator('.cm-content')).toHaveCount(0);
  });

  test('Req 4.2: clicking the toggle opens the literal same CommentEditor the normal comment reply uses, with genuine @-mention completion still wired', async ({
    page,
  }, testInfo) => {
    await page.goto(unifiedReplyPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await item.getByTestId('inline-comment-reply-toggle-button').click();

    // Requirement 4.2: the toggle button is replaced by `CommentEditor` --
    // the exact same component the normal page-bottom comment thread uses
    // for its own replies (not a separate, inline-only input).
    await expect(
      item.getByTestId('inline-comment-reply-toggle-button'),
    ).toHaveCount(0);
    const replyEditor = item.locator('.cm-content');
    await expect(replyEditor).toBeVisible();

    // `CommentEditor` has no explicit mention-picker button (unlike the
    // earlier inline-only MentionAwareCommentInput) -- this locks in that
    // intentional consequence of reusing the normal editor as-is, rather
    // than letting it silently regress unnoticed.
    await expect(item.getByTestId('mention-picker-button')).toHaveCount(0);

    // Prove mention-awareness is still genuinely wired (not merely "looks
    // the same"): typing "@a" triggers CodeMirror's own completion tooltip
    // via the same `createMentionCompletionExtension` mechanism
    // InlineCommentForm's editor uses. "a" is guaranteed to match at least
    // the logged-in admin user (playwright/utils/login.ts), so the
    // candidate list is never empty in this environment.
    await replyEditor.click();
    await replyEditor.pressSequentially('@a');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  });

  test('Req 4.3: Cancel closes the input, restores the "Reply..." button, and posts nothing', async ({
    page,
  }, testInfo) => {
    await page.goto(unifiedReplyPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    const replyEditor = item.locator('.cm-content');
    await expect(replyEditor).toBeVisible();

    const unsentText = 'a reply typed but never submitted, via Cancel';
    await replyEditor.fill(unsentText);
    await expect(replyEditor).toContainText(unsentText);

    // Requirement 4.3: Cancel, not submit -- CommentEditor's own Cancel
    // button (t('Cancel')). CommentEditor renders this button twice (a
    // desktop and a mobile row, toggled by CSS breakpoint, both present in
    // the DOM regardless of viewport) -- `.first()` picks the desktop one,
    // which is the visible, clickable one at this suite's default viewport.
    await item.getByRole('button', { name: 'Cancel' }).first().click();

    // The editor closes and the toggle button reappears.
    await expect(replyEditor).toHaveCount(0);
    const toggleButton = item.getByTestId('inline-comment-reply-toggle-button');
    await expect(toggleButton).toBeVisible();
    await expect(toggleButton).toContainText('Reply...');

    // The unsent text was never posted -- no reply with that text exists.
    await expect(item.getByTestId('inline-comment-reply')).toHaveCount(0);
    await expect(item).not.toContainText(unsentText);
  });

  test('Req 4.5: submitting a reply through the reopened toggle still posts it and returns to the "Reply..." button', async ({
    page,
  }, testInfo) => {
    await page.goto(unifiedReplyPagePath(testInfo.retry));

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    const replyEditor = item.locator('.cm-content');
    await expect(replyEditor).toBeVisible();

    const replyText = 'a reply submitted through the unified reply UI';
    await replyEditor.fill(replyText);
    // CommentEditor's submit button, not the old inline-only
    // `inline-comment-submit-button` (the create form's / reply edit mode's
    // own testid) -- `.first()` for the same desktop/mobile duplication reason
    // as the Cancel button above.
    await item.getByTestId('comment-submit-button').first().click();

    // Requirement 4.5: the reply appears in the list, and the input closes,
    // returning to the "Reply..." toggle button -- the existing
    // submit-and-reflect behavior is unchanged by the UI unification.
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(replyText);

    await expect(replyEditor).toHaveCount(0);
    await expect(
      item.getByTestId('inline-comment-reply-toggle-button'),
    ).toBeVisible();
  });
});

test.describe('Inline comment - the highlight keeps tracking a body change that carries no rendering marker, and stays hoverable/clickable (Req 2.1-2.4, 5.1-5.3)', () => {
  // Serial: the second test reuses the one saved comment created by the
  // first, the same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const markerlessPagePath = (retry: number) =>
    `/inline-comment-e2e-markerless-change${retry}`;

  const targetSentence =
    'This sentence anchors the marker-less DOM change end-to-end test.';
  const introText =
    'Some intro text before the target, hovered to move the pointer away.';
  const pageBody = [
    '# Inline comment E2E - marker-less DOM change',
    '',
    introText,
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  const commentText = 'a comment that must stay reachable after a DOM change';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * How many client rects the saved highlight's registered `Range` currently
   * reports -- the "見た目" half of Requirement 4.1, read directly.
   * `CSS.highlights.get(...)?.size` alone stays `1` even for a `Range` whose
   * text node no longer sits in the document (the Highlight set still holds
   * the object), and such a `Range` paints nothing and -- being the very
   * object `useHighlightHitTest` hit-tests -- is unhittable too. A rect count
   * above zero is what distinguishes "this highlight covers real, laid-out
   * text right now" from "a leftover Range is still registered".
   */
  const highlightRectCount = (targetPage: Page): Promise<number> =>
    targetPage.evaluate(() => {
      const set = CSS.highlights.get('growi-inline-comment');
      const range = set != null ? [...set][0] : undefined;
      return range?.getClientRects().length ?? 0;
    });

  test('Create a page and save an inline comment on the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: markerlessPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();

    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);

    await expect.poll(() => highlightRectCount(page)).toBeGreaterThan(0);
  });

  test('Req 2.1-2.4, 5.1-5.3: when the heading edit button appears late, the highlight is re-resolved against the changed body and hover/click keep opening the popover', async ({
    page,
  }, testInfo) => {
    // The heading's edit button (`Header.tsx`'s `EditLink`) is gated on
    // `isLoadingCurrentPageYjsData`, driven by exactly one client-side fetch
    // (`current-page-yjs-data.ts` -> `/page/{id}/yjs-data`). Delaying that
    // response reproduces requirements.md's own background story -- an
    // operational element inside the body appearing well after the first
    // render, with no `data-growi-is-content-rendering` marker anywhere in
    // the change -- and pins WHEN it appears instead of hoping the fetch
    // happens to still be in flight.
    //
    // The delay has to stay comfortably inside `use-container-settle`'s
    // WATCH_TIMEOUT_MS (10s from mount): past that point the observer is
    // disconnected for good and nothing can fire again, so a longer delay
    // would be testing the timeout fallback rather than this requirement.
    const YJS_DATA_DELAY_MS = 3000;
    await page.route('**/_api/v3/page/*/yjs-data**', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, YJS_DATA_DELAY_MS);
      });
      await route.continue();
    });

    await page.goto(markerlessPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const editButton = page.locator('.wiki .revision-head-edit-button');
    const popover = page.getByTestId('inline-comment-preview-popover');

    // "Before": while the delayed fetch keeps the edit button off the page,
    // the highlight is painted and both interactions open the popover.
    //
    // The heading itself is asserted present first: `toHaveCount(0)` alone
    // would also be satisfied by a body that has not rendered its heading
    // yet, which would make this half of the test pass without ever
    // observing the delayed-loading state it is about.
    await expect(page.locator('.wiki h1')).toBeVisible();
    await expect(editButton).toHaveCount(0);
    await expect.poll(() => highlightRectCount(page)).toBeGreaterThan(0);

    await hoverText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);

    await hoverText(page, introText);
    await expect(popover).not.toBeVisible();

    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);

    // A click pins the popover open (proven by the body-popover suite
    // above), so unpin it before the "after" half -- otherwise that half
    // would be asserting against a popover that simply never closed.
    //
    // The order here matters and is not interchangeable: move the pointer
    // off the highlight FIRST, then close. `InlineCommentBodyInteraction`
    // remembers, by value, whichever hit was showing when the popover was
    // closed, and ignores that same hit afterwards -- so closing while the
    // pointer still sits on the highlight would make the identical hover in
    // the "after" half be ignored. That suppression is existing
    // click/close behavior (Req 2.4), unrelated to what this test is about.
    await hoverText(page, introText);
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: 'Close' }).click();
    await expect(popover).not.toBeVisible();

    // Remember the exact Highlight object registered against the pre-change
    // body. Every `InlineCommentHighlight` pass registers a NEW Highlight
    // (it deletes and re-sets the entry), so "the registry now holds a
    // different object" is the observable evidence that the anchor was
    // re-resolved against the changed body rather than the old result being
    // carried over -- Requirement 4.1's "位置情報を再構築し" and the reason
    // Requirement 3.4 asks for a re-resolution opportunity at all. Captured
    // as late as possible, immediately before the change under test.
    await page.evaluate(() => {
      Reflect.set(
        window,
        '__inlineCommentHighlightBeforeChange',
        CSS.highlights.get('growi-inline-comment'),
      );
    });

    // The marker-less change itself: the button appears once the delayed
    // response lands.
    await expect(editButton.first()).toBeVisible({
      timeout: YJS_DATA_DELAY_MS + 5_000,
    });
    // ...and it really is marker-less -- nothing in the body ever announced
    // itself through the rendering-status protocol this feature's settle
    // detection was originally built around
    // (`GROWI_IS_CONTENT_RENDERING_ATTR`), so this is exactly the kind of
    // change Requirement 3.4 is about.
    await expect(
      page.locator('.wiki [data-growi-is-content-rendering]'),
    ).toHaveCount(0);

    // Requirement 3.4 / 4.1: the change was taken as an opportunity to
    // re-resolve, and the highlight painted afterwards is the rebuilt one.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            CSS.highlights.get('growi-inline-comment') !==
            Reflect.get(window, '__inlineCommentHighlightBeforeChange'),
        ),
      )
      .toBe(true);

    // "After": Requirement 4.1/4.2 (見た目) -- the rebuilt highlight covers
    // real laid-out text, not a leftover Range...
    await expect.poll(() => highlightRectCount(page)).toBeGreaterThan(0);

    // ...and Requirement 4.3 (操作可能範囲) -- the same rebuilt range is what
    // the hit test sees, so hover and click both still open the popover.
    await hoverText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);

    await hoverText(page, introText);
    await expect(popover).not.toBeVisible();

    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(commentText);
  });
});

test.describe('Inline comment - a heading-adjacent comment restores onto the same occurrence whether the collaborative-editing data loads before or after the first anchor resolution (Req 1.1-1.2, 2.1-2.4, 5.1-5.3)', () => {
  // Serial: the timing variants below both read back the single comment the
  // first test really wrote to the backend, the same reasoning the other
  // suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const headingAdjacentPagePath = (retry: number) =>
    `/inline-comment-e2e-heading-adjacent${retry}`;

  // The fixture that makes this suite decisive, and why it has this exact
  // shape.
  //
  // requirements.md's background report for 不具合2(a) found real stored
  // anchors whose context ran straight through a heading's edit button --
  // `"...For Beginnersedit_square\nWith GR..."`. That button
  // (`Header.tsx`'s `EditLink`) is gated on `isLoadingCurrentPageYjsData`, so
  // whether its icon's literal `edit_square` ligature text is part of the
  // body text at any given moment depends on nothing but how far the
  // collaborative-editing fetch has progressed. A comment created while the
  // button is up is therefore captured against a body text that is K
  // characters longer (K = the icon's text length) than the same body a
  // reload shows before that fetch lands.
  //
  // K only ever shifts an offset FORWARD, so the discriminating target is the
  // EARLIER of two identical phrases placed close together right after the
  // heading. `matchExactly` (quote-matcher.ts) keeps whichever exact
  // occurrence starts closest to the stored `approxOffset`; with the two
  // occurrences' offsets o1 and o2 and d = o2 - o1:
  //   - the offset counted WITHOUT the icon text stores o1  → distance 0 to o1
  //   - the offset counted WITH it stores o1 + K            → distance K to o1,
  //                                                            |d - K| to o2
  // so a body counted one way and searched the other picks the WRONG (second)
  // occurrence exactly when d < 2K. `expect(2 * iconTextLength)
  // .toBeGreaterThan(d)` below asserts that inequality against the page as
  // the browser really rendered it, so the fixture cannot go quietly vacuous
  // (a heading that rendered no edit button would make K = 0 and both
  // counting schemes agree).
  //
  // Nothing else in the resolver could rescue the right answer:
  // `matchExactly` disambiguates on `approxOffset` alone, and
  // `matchApproximately`'s own doc comment records that it deliberately
  // ignores `prefix`/`suffix`. The stored offset is the only thing that can
  // tell two identical phrases apart.
  //
  // Both occurrences sit inside ONE paragraph, hence one text node: no
  // excluded (`aria-hidden` / `.katex`) subtree can slip between them, so d
  // is the same number in both counting schemes, and the highlight's
  // `startOffset` inside that node names the chosen occurrence exactly.
  const duplicatedQuote = 'twin phrase';
  const targetParagraph = `Alpha ${duplicatedQuote}, beta ${duplicatedQuote}.`;
  const pageBody = [
    '# Inline comment E2E - heading-adjacent anchor',
    '',
    targetParagraph,
    '',
    'Some trailing text after the target paragraph.',
    '',
  ].join('\n');

  const commentText = 'a comment anchored right after a heading';

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  /**
   * Where the saved highlight actually sits, expressed so that "which of the
   * two identical phrases" is answerable: the matched text, the offset of the
   * match inside its own text node, and the offsets of the first and last
   * occurrence in that same node. Presence alone would not distinguish a
   * correct restore from a restore onto the wrong occurrence, which is the
   * whole question here (the same discipline the formula/duplicate-quote
   * suite above applies).
   */
  const highlightedOccurrence = (
    targetPage: Page,
    quote: string,
  ): Promise<{
    text: string;
    startOffset: number;
    firstIndex: number;
    lastIndex: number;
    nodeText: string;
  } | null> =>
    targetPage.evaluate((needle) => {
      const set = CSS.highlights.get('growi-inline-comment');
      const range = set != null ? [...set][0] : undefined;
      if (range == null) {
        return null;
      }
      const nodeText = range.startContainer.textContent ?? '';
      return {
        text: range.toString(),
        startOffset: range.startOffset,
        firstIndex: nodeText.indexOf(needle),
        lastIndex: nodeText.lastIndexOf(needle),
        nodeText,
      };
    }, quote);

  /**
   * Intercepts every request matching `urlPattern` and holds it -- unanswered,
   * still pending in the browser -- until the returned function is called.
   *
   * Both timing variants below need one fetch to land strictly after (or
   * strictly before) something else the test observes. A fixed delay, the
   * technique the marker-less-DOM-change suite above uses, expresses that as
   * "long enough in practice": it was tried here first and flaked in a
   * whole-file parallel run, where a loaded dev server pushed the *other*
   * fetch past the delay and inverted the very ordering the variant is about.
   * A gate states the ordering instead of timing it, so it cannot invert
   * under load.
   *
   * Holding a request open does not hold up `page.goto`: both gated fetches
   * are issued by client code after hydration, so the load event `goto` waits
   * for has already fired by the time either one is in flight.
   */
  const gateRoute = async (
    targetPage: Page,
    urlPattern: string,
  ): Promise<() => void> => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await targetPage.route(urlPattern, async (route) => {
      await gate;
      await route.continue();
    });
    return release;
  };

  /** The total text length of the excluded, decorative parts of the heading. */
  const headingIconTextLength = (targetPage: Page): Promise<number> =>
    targetPage.evaluate(() =>
      [...document.querySelectorAll('.wiki h1 [aria-hidden="true"]')].reduce(
        (total, el) => total + (el.textContent?.length ?? 0),
        0,
      ),
    );

  /** The gap d between the two identical phrases, read off the real DOM. */
  const occurrenceGap = (targetPage: Page, quote: string): Promise<number> =>
    targetPage.evaluate((needle) => {
      const container = document.querySelector('.wiki');
      if (container == null) {
        throw new Error('page body container (.wiki) not found');
      }
      const text = container.textContent ?? '';
      const first = text.indexOf(needle);
      return text.indexOf(needle, first + 1) - first;
    }, quote);

  test('Create the page, then -- with the heading edit button already up -- comment on the FIRST of the two identical phrases', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: headingAdjacentPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetParagraph);

    // Capture has to happen with the edit button PRESENT: that is the state
    // requirements.md observed in real stored data, and the only state whose
    // body text carries the icon's `edit_square` text at all. Capturing
    // without it would leave nothing for the reload variants to disagree
    // about.
    const editButton = page.locator('.wiki .revision-head-edit-button');
    await expect(editButton.first()).toBeVisible();

    // Fixture validity, measured rather than assumed -- see the reasoning
    // above. Both numbers are read while the button is up, which is the state
    // the stored offset is captured against.
    const iconTextLength = await headingIconTextLength(page);
    const d = await occurrenceGap(page, duplicatedQuote);
    expect(iconTextLength).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
    expect(2 * iconTextLength).toBeGreaterThan(d);

    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // Walks the body's text nodes in document order and selects the first
    // match, i.e. the "Alpha" occurrence -- the earlier one, which is the one
    // the arithmetic above makes discriminating.
    await selectTextInPageBody(page, duplicatedQuote);

    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await expect(form.locator('.inline-comment-form-quote')).toHaveText(
      duplicatedQuote,
    );

    await form.locator('.cm-content').fill(commentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(commentText);
  });

  test('Req 1.1-1.2, 2.1-2.4, 5.1-5.3: with the collaborative-editing fetch held back, the first resolution -- taken while the edit button is still absent -- already lands on the first occurrence, and stays there once the button appears', async ({
    page,
  }, testInfo) => {
    // Variant A: the collaborative-editing data lands AFTER the page's first
    // anchor resolution. Holding back the one client-side fetch the edit
    // button is gated on (`current-page-yjs-data.ts` ->
    // `/page/{id}/yjs-data`) pins that ordering instead of hoping the fetch
    // is still in flight, and keeps the button off the page until this test
    // says otherwise. The hold is released a few assertions later, well
    // inside `use-container-settle`'s WATCH_TIMEOUT_MS (10s from mount) --
    // past that point its observer is disconnected for good, and the second
    // half of this test would be observing the timeout fallback instead of a
    // real re-resolution opportunity.
    const releaseYjsData = await gateRoute(
      page,
      '**/_api/v3/page/*/yjs-data**',
    );

    await page.goto(headingAdjacentPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const editButton = page.locator('.wiki .revision-head-edit-button');

    // The heading itself is asserted present first: `toHaveCount(0)` alone
    // would also be satisfied by a body that has not rendered its heading
    // yet, which would let this half pass without ever observing the
    // still-loading state it is about.
    await expect(page.locator('.wiki h1')).toBeVisible();
    await expect(editButton).toHaveCount(0);

    // Requirement 2.2: resolved while the button is absent, the highlight
    // must still be the one the author selected -- the "Alpha" occurrence.
    await expect
      .poll(() => highlightedOccurrence(page, duplicatedQuote))
      .not.toBeNull();
    const whileLoading = await highlightedOccurrence(page, duplicatedQuote);
    expect(whileLoading?.text).toBe(duplicatedQuote);
    expect(whileLoading?.firstIndex).toBeGreaterThanOrEqual(0);
    expect(whileLoading?.lastIndex).toBeGreaterThan(
      whileLoading?.firstIndex ?? 0,
    );
    expect(whileLoading?.startOffset).toBe(whileLoading?.firstIndex);
    expect(whileLoading?.nodeText.slice(0, whileLoading?.startOffset)).toBe(
      'Alpha ',
    );

    // Now let the gated fetch through, and the button appears...
    releaseYjsData();
    await expect(editButton.first()).toBeVisible();
    // ...and it really is a marker-less change: nothing in the body announced
    // itself through the rendering-status protocol the settle detection was
    // originally built around, so re-resolution here rests on Requirement
    // 3.4's broadened detection.
    await expect(
      page.locator('.wiki [data-growi-is-content-rendering]'),
    ).toHaveCount(0);

    // Requirement 2.2's other half: the state change must not move the
    // highlight either. Polled rather than read once because the appearing
    // button may trigger a re-resolution whose result lands asynchronously;
    // either way the answer must not move. That a re-resolution genuinely
    // runs on such a change is the marker-less-DOM-change suite's job (it
    // compares the registered Highlight object's identity across the
    // change) -- this poll would be satisfied by an answer that simply
    // stayed correct, which is exactly what Requirement 2.2 asks for.
    await expect
      .poll(async () => {
        const current = await highlightedOccurrence(page, duplicatedQuote);
        return {
          text: current?.text,
          onFirstOccurrence: current?.startOffset === current?.firstIndex,
        };
      })
      .toEqual({ text: duplicatedQuote, onFirstOccurrence: true });
  });

  test('Req 1.1-1.2, 2.1-2.4, 5.1-5.3: with the comment list held back until after the edit button is up, the restored highlight lands on the same first occurrence', async ({
    page,
  }, testInfo) => {
    // Variant B: the collaborative-editing data lands BEFORE the page's first
    // anchor resolution. Simply not delaying anything would leave that
    // ordering to a race (the yjs fetch and the comment-list fetch are
    // independent), so the ordering is pinned from the other side instead:
    // the anchors themselves are held back until the edit button is
    // observably on the page, which forces the resolution that matters to run
    // against a body that already contains the icon's text.
    //
    // This arm is the reference result, not a regression test on its own: it
    // passes both before and after the fix (the stored offset and the body it
    // is searched in were counted in the same state), and it is what variant
    // A has to agree with. Requirement 2.2 is the PAIR -- "same result either
    // way" -- so neither test alone states the contract.
    const releaseCommentList = await gateRoute(
      page,
      '**/_api/v3/inline-comments**',
    );

    await page.goto(headingAdjacentPagePath(testInfo.retry));

    const editButton = page.locator('.wiki .revision-head-edit-button');
    await expect(page.locator('.wiki h1')).toBeVisible();
    // The ordering this variant is about, asserted rather than assumed: the
    // button is up before any anchor can have been resolved, because the
    // anchors have not been delivered yet.
    await expect(editButton.first()).toBeVisible();
    expect(await highlightedOccurrence(page, duplicatedQuote)).toBeNull();

    releaseCommentList();
    await expect(page.getByTestId('inline-comment-item').first()).toBeVisible();

    await expect
      .poll(async () => {
        const current = await highlightedOccurrence(page, duplicatedQuote);
        return {
          text: current?.text,
          onFirstOccurrence: current?.startOffset === current?.firstIndex,
        };
      })
      .toEqual({ text: duplicatedQuote, onFirstOccurrence: true });

    const afterLoad = await highlightedOccurrence(page, duplicatedQuote);
    expect(afterLoad?.nodeText.slice(0, afterLoad?.startOffset)).toBe('Alpha ');
  });
});

test.describe('Inline comment - editing an origin comment (from the list and from the popover) and editing a reply from the list all persist across a reload (Req 18.1, 18.2, 15.5)', () => {
  // Serial: each test edits state left behind by the previous one (the
  // origin's text, then the reply's text), same reasoning the other suites
  // in this file use for a single shared fixture.
  test.describe.configure({ mode: 'serial' });

  const editFlowPagePath = (retry: number) =>
    `/inline-comment-e2e-edit${retry}`;

  const targetSentence = 'This sentence anchors the edit-flow end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - edit flow',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and save an inline comment with a reply', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: editFlowPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill('an origin comment before editing');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill('a reply before editing');
    await item.getByTestId('comment-submit-button').first().click();
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toContainText('a reply before editing');

    // The highlight must be registered before the next tests click through it.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 18.1, 18.2: editing the origin comment from the bottom list persists the new text after a reload', async ({
    page,
  }, testInfo) => {
    await page.goto(editFlowPagePath(testInfo.retry));
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // The edit/delete icons are `visibility: hidden` until the origin's own
    // card is hovered (the hover-reveal pattern the visual refresh adopted
    // from `CommentControl.tsx`, scoped per-row since 2026-09-11 方針転換
    // その6), so the card has to be hovered before the icon is clickable at
    // all -- a click without it times out on "element is not visible". This
    // item carries a reply (from the previous test), so hovering the whole
    // `item` would not reliably land on the origin's own box -- hover
    // `.page-comment` (the origin's box specifically) instead.
    const card = item.locator('.page-comment').first();
    await card.hover();
    await item.getByTestId('inline-comment-edit-button').click();
    // 2026-09-11: origin editing now uses the literal same `CommentEditor`
    // the normal comment's own re-edit uses (matching the user's request to
    // unify the two editing experiences), so the edit surface is no longer a
    // bare `.inline-comment-edit-form` wrapper -- it is `CommentEditor`'s own
    // full UI (toolbar, preview tab, `comment-submit-button`).
    await expect(item.locator('.cm-content')).toBeVisible();
    await item
      .locator('.cm-content')
      .fill('an origin comment edited from the list');
    await item.getByTestId('comment-submit-button').first().click();

    await expect(item.locator('.cm-content')).not.toBeVisible();
    await expect(item).toContainText('an origin comment edited from the list');

    await page.reload();
    const reloadedItem = page.getByTestId('inline-comment-item').first();
    await expect(reloadedItem).toContainText(
      'an origin comment edited from the list',
    );
  });

  test('Req 15.5: editing the origin comment from the body popover persists the new text after a reload', async ({
    page,
  }, testInfo) => {
    await page.goto(editFlowPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(
      'an origin comment edited from the list',
    );

    await popover
      .getByTestId('inline-comment-preview-popover-edit-button')
      .click();
    // By test id, not by a `.inline-comment-preview-popover-edit-form` CSS
    // class: the popover's edit-mode wrapper carries no such class (it never
    // did once the visual refresh gave it Bootstrap's accent-border utilities
    // plus this test id), so the old class selector matched nothing.
    const editForm = popover.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    await expect(editForm).toBeVisible();
    await editForm
      .locator('.cm-content')
      .fill('an origin comment edited from the popover');
    await editForm
      .getByTestId('inline-comment-preview-popover-edit-save-button')
      .click();
    await expect(editForm).not.toBeVisible();
    await expect(popover).toContainText(
      'an origin comment edited from the popover',
    );

    // Persists across a reload, both in the popover and in the bottom list.
    await page.reload();
    await expect(page.getByTestId('inline-comment-item').first()).toContainText(
      'an origin comment edited from the popover',
    );

    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    const reopenedPopover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(reopenedPopover).toBeVisible();
    await expect(reopenedPopover).toContainText(
      'an origin comment edited from the popover',
    );
  });

  test('Req 18.1, 18.2: editing a reply from the bottom list persists the new text after a reload', async ({
    page,
  }, testInfo) => {
    await page.goto(editFlowPagePath(testInfo.retry));
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply).toContainText('a reply before editing');

    // Hover first: the reply's edit/delete icons are hover-revealed too (they
    // reuse the list item's own `visibility` rule -- see the comment on the
    // origin comment's edit click above).
    await reply.hover();
    await reply.getByTestId('inline-comment-reply-edit-button').click();
    // 2026-09-11: reply editing now uses the literal same `CommentEditor` the
    // origin comment's edit mode and the normal comment's re-edit both use
    // (see the origin-edit test above).
    await expect(reply.locator('.cm-content')).toBeVisible();
    await reply.locator('.cm-content').fill('a reply edited from the list');
    await reply.getByTestId('comment-submit-button').first().click();
    await expect(reply.locator('.cm-content')).not.toBeVisible();
    await expect(reply).toContainText('a reply edited from the list');

    await page.reload();
    const reloadedItem = page.getByTestId('inline-comment-item').first();
    const reloadedReply = reloadedItem.getByTestId('inline-comment-reply');
    await expect(reloadedReply).toContainText('a reply edited from the list');
  });
});

test.describe('Inline comment - deleting a reply removes only that reply; deleting the origin comment removes it, all its replies, and the body highlight/popover (Req 18.5, 18.6, 2.8)', () => {
  // Serial: the second test deletes one of the two replies created by the
  // first, and the third deletes the origin comment the first two depend on
  // -- same reasoning the other suites in this file use for a single shared
  // fixture.
  test.describe.configure({ mode: 'serial' });

  const deleteFlowPagePath = (retry: number) =>
    `/inline-comment-e2e-delete${retry}`;

  const targetSentence =
    'This sentence anchors the delete-flow end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - delete flow',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and save an inline comment with two replies', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: deleteFlowPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill('an origin comment to be deleted');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // First reply.
    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill('the first reply');
    await item.getByTestId('comment-submit-button').first().click();
    await expect(
      item.getByTestId('inline-comment-reply').first(),
    ).toContainText('the first reply');

    // Second reply.
    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill('the second reply');
    await item.getByTestId('comment-submit-button').first().click();
    await expect(item.getByTestId('inline-comment-reply')).toHaveCount(2);

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 18.5: deleting a reply removes only that reply -- the origin comment and the other reply remain', async ({
    page,
  }, testInfo) => {
    await page.goto(deleteFlowPagePath(testInfo.retry));
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item.getByTestId('inline-comment-reply')).toHaveCount(2);

    const firstReply = item
      .getByTestId('inline-comment-reply')
      .filter({ hasText: 'the first reply' });
    // Hover first -- hover-revealed icon, same as the edit case above.
    await firstReply.hover();
    await firstReply.getByTestId('inline-comment-reply-delete-button').click();
    await expect(
      firstReply.getByTestId('inline-comment-reply-delete-confirm'),
    ).toBeVisible();
    await firstReply
      .getByTestId('inline-comment-reply-delete-confirm-button')
      .click();

    await expect(item.getByTestId('inline-comment-reply')).toHaveCount(1);
    await expect(item.getByTestId('inline-comment-reply')).toContainText(
      'the second reply',
    );
    await expect(item).toContainText('an origin comment to be deleted');

    await page.reload();
    const reloadedItem = page.getByTestId('inline-comment-item').first();
    await expect(reloadedItem.getByTestId('inline-comment-reply')).toHaveCount(
      1,
    );
    await expect(
      reloadedItem.getByTestId('inline-comment-reply'),
    ).toContainText('the second reply');
  });

  test('Req 18.5, 18.6, 2.8: deleting the origin comment removes it, its remaining reply, and the body highlight/popover', async ({
    page,
  }, testInfo) => {
    await page.goto(deleteFlowPagePath(testInfo.retry));
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    // Hover the origin's own `.page-comment` box, not the whole item --
    // this item carries a reply thread (from the previous test in this
    // serial group), so `item.hover()` would land its pointer somewhere
    // across the combined origin+replies bounding box instead of on the
    // origin's own row. The hover-reveal is now scoped per-row (2026-09-11
    // 方針転換その6: unify with normal comments' per-row reveal), so it only
    // fires for the box actually under the pointer.
    const card = item.locator('.page-comment').first();
    await card.hover();
    await item.getByTestId('inline-comment-delete-button').click();
    await expect(
      item.getByTestId('inline-comment-delete-confirm'),
    ).toBeVisible();
    await item.getByTestId('inline-comment-delete-confirm-button').click();

    await expect(page.getByTestId('inline-comment-item')).toHaveCount(0);

    // Requirement 2.8: the highlight disappears without needing a reload.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBe(0);

    await page.reload();
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    await expect(page.getByTestId('inline-comment-item')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      ),
    ).toBe(0);

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).not.toBeVisible();
  });
});

test.describe("Inline comment - a non-owner browser session sees no edit/delete controls for someone else's comment, in the list and the popover (Req 18.1, 18.5, 15.5)", () => {
  // Serial: the second and third tests both read the fixture the first test
  // creates as the admin user, and check what a DIFFERENT logged-in user
  // (FILTER_TEST_USER_A, provisioned by playwright/users.setup.ts and
  // reused here as a generic "some other user" session -- it has no
  // relationship to the search-filter tests it was originally provisioned
  // for) sees for it.
  test.describe.configure({ mode: 'serial' });

  const nonOwnerPagePath = (retry: number) =>
    `/inline-comment-e2e-non-owner${retry}`;

  const targetSentence = 'This sentence anchors the non-owner end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - non-owner',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and save an inline comment with a reply, as the admin user', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: nonOwnerPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill('an origin comment owned by admin');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill('a reply owned by admin');
    await item.getByTestId('comment-submit-button').first().click();
    await expect(item.getByTestId('inline-comment-reply')).toContainText(
      'a reply owned by admin',
    );

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 18.1, 18.5: a different, non-owner user sees no edit/delete controls in the list, for either the origin comment or the reply', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      storageState: FILTER_TEST_USER_A.authFile,
    });
    try {
      const page = await context.newPage();
      await page.goto(nonOwnerPagePath(testInfo.retry));

      const item = page.getByTestId('inline-comment-item').first();
      await expect(item).toBeVisible();
      await expect(item).toContainText('an origin comment owned by admin');

      await expect(item.getByTestId('inline-comment-edit-button')).toHaveCount(
        0,
      );
      await expect(
        item.getByTestId('inline-comment-delete-button'),
      ).toHaveCount(0);

      const reply = item.getByTestId('inline-comment-reply');
      await expect(reply).toContainText('a reply owned by admin');
      await expect(
        reply.getByTestId('inline-comment-reply-edit-button'),
      ).toHaveCount(0);
      await expect(
        reply.getByTestId('inline-comment-reply-delete-button'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('Req 15.5: the same non-owner user sees no edit control in the body popover for the origin comment', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      storageState: FILTER_TEST_USER_A.authFile,
    });
    try {
      const page = await context.newPage();
      await page.goto(nonOwnerPagePath(testInfo.retry));
      await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

      const popover = page.getByTestId('inline-comment-preview-popover');
      await clickText(page, targetSentence);
      await expect(popover).toBeVisible();
      await expect(popover).toContainText('an origin comment owned by admin');
      await expect(
        popover.getByTestId('inline-comment-preview-popover-edit-button'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

test.describe('Inline comment - a resolved comment hides its body highlight/popover but stays listed; resolving from an open popover closes it (Req 2.7, 15.12)', () => {
  // Serial: the second test resolves the one comment created by the first,
  // and the third reloads to check the resolved state persists across a
  // fresh load -- same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const resolvedPagePath = (retry: number) =>
    `/inline-comment-e2e-resolved${retry}`;

  const targetSentence =
    'This sentence anchors the resolved-comment end-to-end test.';
  const pageBody = [
    '# Inline comment E2E - resolved comment',
    '',
    targetSentence,
    '',
  ].join('\n');

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page and save an inline comment', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: resolvedPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill('a comment that will be resolved');
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('Req 15.12: resolving from within the open popover closes the popover; the comment stays listed as resolved', async ({
    page,
  }, testInfo) => {
    await page.goto(resolvedPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const popover = page.getByTestId('inline-comment-preview-popover');
    await clickText(page, targetSentence);
    await expect(popover).toBeVisible();

    await popover.getByRole('button', { name: 'Resolve' }).click();
    await expect(popover).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );
  });

  test('Req 2.7, 4.4: a resolved comment shows no highlight and no popover in the body after reloading, but still appears in the list', async ({
    page,
  }, testInfo) => {
    await page.goto(resolvedPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // Requirement 4.4: still listed at the bottom of the page.
    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );

    // Requirement 2.7: no highlight registered in the body.
    expect(
      await page.evaluate(
        () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
      ),
    ).toBe(0);

    // Requirement 2, AC 2.7: hovering/clicking where the highlight used to
    // be shows no popover, since there is nothing left to hit-test against.
    const popover = page.getByTestId('inline-comment-preview-popover');
    await hoverText(page, targetSentence);
    await expect(popover).not.toBeVisible();
    await clickText(page, targetSentence);
    await expect(popover).not.toBeVisible();
  });

  test('Requirement 16: clicking a RESOLVED comment in the list still scrolls to its quote instead of reporting "could not be found" -- resolving must only suppress the passive highlight/popover, not list-click navigation', async ({
    page,
  }, testInfo) => {
    await page.goto(resolvedPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );

    const quoteButton = item
      .getByRole('button')
      .filter({ hasText: targetSentence });

    await quoteButton.click();

    // The regression this guards against: PageView.tsx once excluded resolved
    // comments from anchor resolution entirely, so `scrollToRange` could no
    // longer locate the comment's Range and fell back to the generic
    // not-found error toast -- even though the commented text is still on the
    // page, unedited, simply resolved.
    await expect(page.locator('.Toastify__toast')).not.toBeVisible();

    const emphasisHighlightSize = () =>
      page.evaluate(
        () => CSS.highlights.get('growi-inline-comment-emphasis')?.size ?? 0,
      );
    await expect.poll(emphasisHighlightSize).toBeGreaterThan(0);
  });
});

test.describe('Inline comment - visual refresh: mockup cross-check captures', () => {
  // Serial: every test below builds on real backend state created by the
  // earlier ones (the page, then the origin comment, then its reply), the
  // same reasoning the other suites in this file use.
  test.describe.configure({ mode: 'serial' });

  const visualRefreshPagePath = (retry: number) =>
    `/inline-comment-e2e-visual-refresh${retry}`;

  const targetSentence =
    'This sentence anchors the visual-refresh mockup cross-check.';
  const pageBody = [
    '# Inline comment E2E - visual refresh',
    '',
    'Some intro text before the target.',
    '',
    targetSentence,
    '',
    'Some trailing text after the target.',
    '',
  ].join('\n');

  const originCommentText =
    'The premise would read better if it came first; how about splitting the section?';
  const replyText =
    'Agreed - one sentence of context between sections 3 and 4 would help.';
  const secondReplyText =
    'A second reply, so the gap between two replies can be measured.';

  /**
   * Where the captured evidence for this spec lands. Deliberately NOT
   * `playwright/output` (that directory is gitignored, so nothing there
   * survives for the independent checklist review in task 4.4): the
   * screenshots and the measurement dumps are the deliverable this suite
   * exists to produce, so they are written to a tracked path instead.
   */
  const evidenceDir = path.resolve(
    import.meta.dirname,
    './__screenshots__/inline-comment-visual-refresh',
  );

  /**
   * Same rationale as the visual-consistency suite's own copy above: a
   * `getComputedStyle` read taken while Bootstrap's ~150ms color/opacity
   * transitions are still running reports a mid-transition value rather than
   * the settled one, and a screenshot taken then catches a half-faded
   * hover-reveal. Kept as this block's own copy because that helper is scoped
   * inside the other `describe`.
   */
  const disableCssTransitions = async (targetPage: Page): Promise<void> => {
    await targetPage.addStyleTag({
      content:
        '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });
  };

  /**
   * Waits until `popover`'s own `boundingBox()` reads identically on two
   * consecutive polls before returning -- both the screenshot and
   * `collectMetrics`/`writeMetrics` calls for popover states 5/6 must run
   * only after this resolves.
   *
   * Why this exists: the popover's `Locator.isVisible()`/`toContainText()`
   * assertions used before this helper was added only prove the popover has
   * *mounted* and has the expected text -- they say nothing about whether its
   * layout (element spacing in particular) has finished settling. A prior
   * capture run took the PNG screenshot and the JSON metrics dump far enough
   * apart in time that a reflow happened in between, so the committed
   * `05-popover-normal.png` (444px tall) and that same commit's
   * `05-popover-normal.json` (526px) ended up describing two different
   * layouts of the same popover. Polling the box at a short interval and
   * requiring it to stop moving before capturing anything makes the
   * screenshot and the metrics dump describe the same, settled layout.
   *
   * Fails loudly (throws) rather than silently proceeding with a
   * still-shifting layout if the box never stabilizes within `timeoutMs`.
   */
  const waitForPopoverToSettle = async (
    popover: Locator,
    timeoutMs = 5000,
    intervalMs = 150,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let previousBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null;

    while (Date.now() < deadline) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design -- each poll must observe the box only after the previous wait
      const box = await popover.boundingBox();
      if (box == null) {
        throw new Error(
          'popover bounding box unavailable while waiting for its layout to settle',
        );
      }
      if (
        previousBox != null &&
        box.x === previousBox.x &&
        box.y === previousBox.y &&
        box.width === previousBox.width &&
        box.height === previousBox.height
      ) {
        return;
      }
      previousBox = box;
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }

    throw new Error(
      `popover layout did not settle within ${timeoutMs}ms (still moving/resizing on the last two polls)`,
    );
  };

  /**
   * The computed properties every measured element reports. Judging mockup
   * fidelity means answering questions like "is the gap between the badge
   * and the toggle button mockup-equivalent?" and "is the quote block's
   * left/right inner padding right?" — those are measurements, and
   * eyeballing a PNG is exactly the failure mode this whole spec exists to
   * prevent. So each capture below is paired with a dump of these values
   * plus every element's `getBoundingClientRect()`, which is what makes a
   * verdict checkable rather than an opinion.
   */
  const STYLE_PROPS = [
    'display',
    'position',
    'visibility',
    'opacity',
    'flexDirection',
    'alignItems',
    'justifyContent',
    'columnGap',
    'rowGap',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderLeftColor',
    'borderLeftStyle',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
    'backgroundColor',
    'color',
    'fontSize',
    'lineHeight',
    'textAlign',
    'whiteSpace',
    'width',
    'height',
  ] as const;

  type ElementMetrics = {
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
    };
    styles: Record<string, string>;
    /** Whether the element's content overflows its own box (i.e. is clipped). */
    overflow: {
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
    };
    /**
     * The `::before` pseudo-element's own computed values. Three checklist
     * items are judged through a pseudo-element rather than a real node: the
     * status badge's dot (item 2), the card's shared speech-balloon tail
     * (item 35), and — for the tail — whether the shared placeholder was
     * overridden at all. A pseudo-element has no `getBoundingClientRect()`,
     * so its `content`/size/border values are the only observable evidence.
     */
    before: Record<string, string>;
  };

  /**
   * Measures every entry of `targets` (name -> CSS selector, resolved inside
   * `rootSelector`; the empty selector means the root itself) in one round
   * trip. A missing element is reported as `null` rather than throwing, so a
   * dump still records "this element was absent" — which is itself the answer
   * for the items that require an element NOT to be present in a given state
   * (item 4: no edit/delete icons while editing or confirming a delete).
   */
  const collectMetrics = (
    targetPage: Page,
    rootSelector: string,
    targets: Record<string, string>,
  ): Promise<Record<string, ElementMetrics | null>> =>
    targetPage.evaluate(
      ({ rootSel, entries, props, pseudoProps }) => {
        const root = document.querySelector(rootSel);
        if (root == null) {
          throw new Error(`metrics root not found: ${rootSel}`);
        }

        const readStyles = (
          style: CSSStyleDeclaration,
          names: readonly string[],
        ): Record<string, string> =>
          Object.fromEntries(
            names.map((name) => [
              name,
              style.getPropertyValue(
                name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
              ),
            ]),
          );

        const out: Record<string, unknown> = {};
        for (const [name, selector] of Object.entries(entries)) {
          const el =
            selector === '' ? root : root.querySelector(selector as string);
          if (el == null) {
            out[name] = null;
            continue;
          }
          const rect = el.getBoundingClientRect();
          out[name] = {
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            },
            // `scrollWidth > clientWidth` is the observable form of "this row
            // does not fit and is being clipped" -- the failure mode a fixed
            // popover width can introduce in the header row, and one that a
            // screenshot of a *wide* popover would never reveal.
            overflow: {
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            },
            styles: readStyles(window.getComputedStyle(el), props),
            before: readStyles(
              window.getComputedStyle(el, '::before'),
              pseudoProps,
            ),
          };
        }
        return out;
      },
      {
        rootSel: rootSelector,
        entries: targets,
        props: [...STYLE_PROPS],
        pseudoProps: [
          'content',
          'display',
          'position',
          'width',
          'height',
          'marginRight',
          'backgroundColor',
          'borderTopWidth',
          'borderRightWidth',
          'borderLeftWidth',
          'borderTopLeftRadius',
          'borderTopColor',
        ],
      },
    ) as Promise<Record<string, ElementMetrics | null>>;

  const writeMetrics = (name: string, metrics: unknown): void => {
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, `${name}.json`),
      `${JSON.stringify(metrics, null, 2)}\n`,
    );
  };

  /** Selectors for the list item's own card (its nested replies excluded). */
  const LIST_TARGETS: Record<string, string> = {
    // The outer `.page-comment`, which is where the resolved state's fade
    // (`opacity-75`) is applied -- the inner `.page-comment-main` measured
    // below stays at opacity 1 in both states, so measuring only that one
    // would report "no fade" for a resolved card that is in fact faded.
    cardRoot: ':scope > .page-comment',
    card: ':scope > .page-comment > .page-comment-main',
    headerRow: ':scope > .page-comment > .page-comment-main > .d-flex',
    avatar: ':scope > .page-comment > .page-comment-main .user-picture',
    username: ':scope > .page-comment > .page-comment-main > .d-flex > .small',
    createdAt: '.page-comment-revision',
    headerEnd:
      ':scope > .page-comment > .page-comment-main > .d-flex > .ms-auto',
    iconButtonContainer: '[class*="icon-button-container"]',
    editIconButton: '[data-testid="inline-comment-edit-button"]',
    deleteIconButton: '[data-testid="inline-comment-delete-button"]',
    statusBadge: '[data-testid="inline-comment-status"]',
    // Descendant selector, not `>`: the toggle is no longer a direct child of
    // `.ms-auto` (2026-09-11) -- it moved inside its own hover-reveal
    // `.icon-button-container` span, alongside edit/delete, to match their
    // hover behavior (user request).
    resolveToggle: '.ms-auto button.btn-outline-secondary',
    typeLabel: '.text-body-secondary.fw-bold',
    quote: '.inline-comment-quote',
    body: ':scope > .page-comment > .page-comment-main > .page-comment-body',
    replyFormAvatar: '.inline-comment-reply-form .user-picture',
    // 2026-09-11: origin/reply editing now uses the literal same
    // `CommentEditor` the normal comment's re-edit uses (no more
    // `.inline-comment-edit-form` wrapper or dedicated Save/Cancel testids)
    // -- `.comment-form` is `CommentEditorLayout`'s own plain (non-CSS-Module)
    // wrapper class, and the Cancel button has no testid of its own, so it is
    // matched by its own plain Bootstrap classes (the desktop row's `d-none
    // d-sm-block` copy is first in DOM order and visible at this capture's
    // desktop viewport).
    editForm: '.comment-form',
    editCancelButton: '.btn-outline-neutral-secondary',
    editSubmitButton: '[data-testid="comment-submit-button"]',
    deleteConfirm: '[data-testid="inline-comment-delete-confirm"]',
    deleteConfirmIcon:
      '[data-testid="inline-comment-delete-confirm"] .material-symbols-outlined',
    deleteConfirmMessage:
      '[data-testid="inline-comment-delete-confirm"] > span:nth-of-type(2)',
    deleteConfirmActions:
      '[data-testid="inline-comment-delete-confirm"] .ms-auto',
    deleteConfirmCancel: '[data-testid="inline-comment-delete-cancel-button"]',
    deleteConfirmDelete: '[data-testid="inline-comment-delete-confirm-button"]',
  };

  const POPOVER_TARGETS: Record<string, string> = {
    popover: '',
    cardBody: ':scope > .card-body',
    closeButton: '.btn-close',
    // The origin comment is the popover's own markup, not a `CommentCard`
    // (design.md「Popover 再設計」), so these target its own test ids. The
    // `.page-comment*` selectors they replace now resolve to the first reply
    // instead -- which still reads as a hit, and would have reported a
    // reply's measurements as the origin comment's.
    origin: '[data-testid="inline-comment-preview-popover-origin"]',
    headerRow: '[data-testid="inline-comment-preview-popover-header"]',
    avatar:
      '[data-testid="inline-comment-preview-popover-header"] .user-picture',
    username:
      '[data-testid="inline-comment-preview-popover-header"] > .fw-semibold',
    createdAt:
      '[data-testid="inline-comment-preview-popover-header"] > .text-body-secondary',
    headerEnd:
      '[data-testid="inline-comment-preview-popover-header"] > .ms-auto',
    editButton: '[data-testid="inline-comment-preview-popover-edit-button"]',
    resolveToggle: '.ms-auto > button.btn-outline-secondary',
    quote: '[data-testid="inline-comment-preview-popover-quote"]',
    body: '[data-testid="inline-comment-preview-popover-body"]',
    firstDivider: 'hr',
    replies: '[data-testid="inline-comment-preview-popover-replies"]',
    firstReply: '[data-testid="inline-comment-preview-popover-reply"]',
    firstReplyAvatar:
      '[data-testid="inline-comment-preview-popover-reply"] .user-picture',
    firstReplyUsername:
      '[data-testid="inline-comment-preview-popover-reply"] [data-testid="inline-comment-preview-popover-reply-header"] > .fw-semibold',
    firstReplyBody:
      '[data-testid="inline-comment-preview-popover-reply"] [data-testid="inline-comment-preview-popover-reply-body"]',
    secondReply:
      '[data-testid="inline-comment-preview-popover-reply"]:nth-of-type(2)',
    closeButtonInHeader:
      '[data-testid="inline-comment-preview-popover-close-button"]',
    replyForm: '.inline-comment-preview-popover-reply-form',
    replyFormAvatar: '.inline-comment-preview-popover-reply-form .user-picture',
    // 2026-09-11 その4: the reply composer swapped its plain `<textarea>` for
    // `MentionAwareCommentInput` (a CodeMirror editor), same as every other
    // comment input in this feature -- `.cm-content` is the established
    // selector for that editor's editable surface (see the many `.cm-content`
    // usages elsewhere in this file).
    replyFormInput: '.inline-comment-preview-popover-reply-form .cm-content',
    replyFormMentionPicker:
      '.inline-comment-preview-popover-reply-form [data-testid="mention-picker-button"]',
    replyFormSubmit:
      '.inline-comment-preview-popover-reply-form button.btn-primary',
    editForm: '[data-testid="inline-comment-preview-popover-edit-form"]',
    editCancelButton:
      '[data-testid="inline-comment-preview-popover-edit-cancel-button"]',
    editSubmitButton:
      '[data-testid="inline-comment-preview-popover-edit-save-button"]',
  };

  /** Every divider in the popover, measured together for items 21 and 26. */
  const collectDividers = (targetPage: Page): Promise<unknown> =>
    targetPage.evaluate(() => {
      const popover = document.querySelector(
        '[data-testid="inline-comment-preview-popover"]',
      );
      if (popover == null) {
        throw new Error('popover not found');
      }
      const cardBody = popover.querySelector('.card-body');
      const cardBodyRect = cardBody?.getBoundingClientRect();
      return {
        cardBody:
          cardBodyRect == null
            ? null
            : { left: cardBodyRect.left, right: cardBodyRect.right },
        dividers: Array.from(popover.querySelectorAll('hr')).map((hr) => {
          const rect = hr.getBoundingClientRect();
          const style = window.getComputedStyle(hr);
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
            borderTopWidth: style.borderTopWidth,
            color: style.color,
            opacity: style.opacity,
          };
        }),
      };
    });

  let createdPage: CreatedPage | undefined;

  test.afterAll(async ({ request }) => {
    if (createdPage != null) {
      await deletePagesCompletely(request, [createdPage]);
    }
  });

  test('Create a page containing the target sentence', async ({
    page,
    request,
  }, testInfo) => {
    createdPage = await createPage(request, {
      path: visualRefreshPagePath(testInfo.retry),
      body: pageBody,
    });

    await page.goto(createdPage.path);
    await expect(page.locator('.wiki').first()).toContainText(targetSentence);
  });

  test('Create the origin comment and one reply (the popover normal state needs both)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualRefreshPagePath(testInfo.retry));
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    await selectTextInPageBody(page, targetSentence);
    await page.getByTestId('selection-action-button').click();
    const form = page.getByTestId('inline-comment-form');
    await expect(form).toBeVisible();
    await form.locator('.cm-content').fill(originCommentText);
    await form.getByTestId('inline-comment-submit-button').click();
    await expect(form).not.toBeVisible();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(originCommentText);

    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill(replyText);
    await item.getByTestId('comment-submit-button').first().click();

    const reply = item.getByTestId('inline-comment-reply');
    await expect(reply.first()).toBeVisible();
    await expect(reply.first()).toContainText(replyText);

    // A SECOND reply, so the spacing *between* two replies is a measured
    // value rather than one inferred from the class list -- the
    // reply-to-reply gap, which a single reply cannot show.
    await item.getByTestId('inline-comment-reply-toggle-button').click();
    await item.locator('.cm-content').fill(secondReplyText);
    await item.getByTestId('comment-submit-button').first().click();
    await expect(reply).toHaveCount(2);
  });

  test('Capture popover states 5 (normal, with replies + reply form) and 6 (edit mode)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualRefreshPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    // The saved highlight must actually be registered before the popover can
    // be opened at all -- it is what `useHighlightHitTest` hit-tests against.
    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    // A click (not a hover) pins the popover open via its `onPointerEnter`
    // promotion, which is what makes it stable enough to screenshot and
    // measure without the pointer having to stay parked on the text.
    await clickText(page, targetSentence);
    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(originCommentText);
    await expect(
      popover.getByTestId('inline-comment-preview-popover-reply'),
    ).toHaveCount(2);
    await waitForPopoverToSettle(popover);

    fs.mkdirSync(evidenceDir, { recursive: true });
    await popover.screenshot({
      path: path.join(evidenceDir, '05-popover-normal.png'),
    });
    writeMetrics('05-popover-normal', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-preview-popover"]',
        POPOVER_TARGETS,
      ),
      dividers: await collectDividers(page),
    });

    // State 6: edit mode replaces the body, the reply list and the reply form.
    await popover
      .getByTestId('inline-comment-preview-popover-edit-button')
      .click();
    const editForm = popover.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('.cm-content')).toBeVisible();
    // Formerly a known bug (`codeMirrorEditor.initDoc(initialValue)` never
    // populated `.cm-content` in a real browser -- see tasks.md Implementation
    // Notes) -- fixed 2026-09-11 in packages/editor's useCodeMirrorEditorIsolated
    // (an invalid, view-less editor could reach the shared atom as the first
    // published value, and MentionAwareCommentInput's one-shot initDoc call
    // would silently no-op against it). Assert the restoration now that it's
    // fixed, so a regression here fails loudly instead of being missed.
    await expect(editForm.locator('.cm-content')).toContainText(
      originCommentText,
    );
    await waitForPopoverToSettle(popover);

    await popover.screenshot({
      path: path.join(evidenceDir, '06-popover-edit.png'),
    });
    writeMetrics('06-popover-edit', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-preview-popover"]',
        POPOVER_TARGETS,
      ),
      dividers: await collectDividers(page),
    });
  });

  test('Capture list-item states 1 (normal/unresolved), 2 (edit mode), 3 (delete confirmation) and 4 (resolved)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualRefreshPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    const card = item.locator('.page-comment').first();
    const editButton = item.getByTestId('inline-comment-edit-button');
    const deleteButton = item.getByTestId('inline-comment-delete-button');

    fs.mkdirSync(evidenceDir, { recursive: true });

    // --- State 1: normal (unresolved), hovered so the edit/delete icons show ---
    // The icons are `visibility: hidden` until the card is hovered, so the
    // order here matters: scroll first (a later scroll would move the pointer
    // off the card), hover, then assert the icons are actually VISIBLE --
    // `toBeVisible()` fails on `visibility: hidden`, so it is a real guard
    // that the hover took effect rather than a screenshot of a still-hidden
    // control.
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect(editButton).toBeVisible();
    await expect(deleteButton).toBeVisible();

    await card.screenshot({
      path: path.join(evidenceDir, '01-list-normal.png'),
    });
    await page.screenshot({
      path: path.join(evidenceDir, '01-list-normal-fullpage.png'),
      fullPage: true,
    });
    writeMetrics('01-list-normal', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    // --- State 2: edit mode ---
    await editButton.click();
    // 2026-09-11: origin editing now uses the literal same `CommentEditor`
    // the normal comment's own re-edit uses -- `.comment-form` is
    // `CommentEditorLayout`'s own plain wrapper class (no more
    // `.inline-comment-edit-form`).
    const editForm = item.locator('.comment-form');
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('.cm-content')).toBeVisible();
    // See the matching comment in the popover capture above -- fixed
    // 2026-09-11, asserted here too.
    await expect(editForm.locator('.cm-content')).toContainText(
      originCommentText,
    );
    // 2026-09-11 (方針転換その12): `card` (`.page-comment`) no longer exists
    // while editing -- the whole box is replaced by the bare editor, so
    // `card`'s locator would now resolve to the NEXT `.page-comment` in the
    // item (a reply's own box) instead of failing loudly. Screenshot/hover
    // `item` itself (the origin comment's outer container, which still
    // exists) for this state.
    await item.hover();

    await item.screenshot({ path: path.join(evidenceDir, '02-list-edit.png') });
    writeMetrics('02-list-edit', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    await item.locator('.btn-outline-neutral-secondary').first().click();
    await expect(editForm).not.toBeVisible();

    // --- State 3: delete confirmation (cancelled again right afterwards --
    // this suite must not actually delete the comment state 4 still needs) ---
    await card.hover();
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    const deleteConfirm = item.getByTestId('inline-comment-delete-confirm');
    await expect(deleteConfirm).toBeVisible();
    await card.hover();

    await card.screenshot({
      path: path.join(evidenceDir, '03-list-delete-confirm.png'),
    });
    writeMetrics('03-list-delete-confirm', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    await item.getByTestId('inline-comment-delete-cancel-button').click();
    await expect(deleteConfirm).not.toBeVisible();

    // --- State 4: resolved ---
    // 2026-09-11: the resolve/reopen toggle is now hover-revealed like
    // edit/delete (user request), so it needs the same hover-first
    // treatment the other buttons in this test already get.
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await item.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );
    await card.hover();
    await expect(editButton).toBeVisible();

    await card.screenshot({
      path: path.join(evidenceDir, '04-list-resolved.png'),
    });
    writeMetrics('04-list-resolved', {
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    // Left resolved-free for any retry of this serial group: reopening keeps
    // the created comment in the same state the earlier tests set up.
    await item.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Unresolved',
    );
  });

  // --- Task 4.2: the same 6 states, captured in dark mode -------------------
  // Requirement 4.4 asks whether the semantic color classes this spec uses
  // (`bg-warning-subtle`/`text-warning-emphasis` on the unresolved badge,
  // `bg-success-subtle`/`text-success-emphasis` on the resolved one,
  // `alert-danger` on the delete confirmation) keep their intended role in
  // BOTH color modes. The two tests below re-capture the same 6 states the
  // light-mode tests above capture, with `data-bs-theme="dark"` set, and dump
  // the same measured values so the light/dark colors can be compared value
  // by value rather than eyeballed.

  /**
   * Same technique (and same rationale) as the visual-consistency suite's own
   * `setBsTheme` further up this file: `data-bs-theme` on `<html>` is the
   * exact attribute Bootstrap's `color-mode` mixin keys its dark rule set off
   * (`[data-bs-theme="dark"] { ... }`), and nothing was observed to overwrite
   * it once written. Kept as this block's own copy because that helper is
   * scoped inside the other `describe`.
   */
  const setBsTheme = async (
    targetPage: Page,
    theme: 'light' | 'dark',
  ): Promise<void> => {
    await targetPage.evaluate((t) => {
      document.documentElement.setAttribute('data-bs-theme', t);
    }, theme);
  };

  /**
   * The page-level colors the whole Bootstrap theme hangs off. Read in light
   * and again in dark, they are the guard that the theme switch ACTUALLY took
   * effect: without it, a run where `data-bs-theme` never reached the
   * stylesheet would silently produce six light-looking screenshots and every
   * "dark mode is fine" claim built on them would be unfalsifiable — exactly
   * the failure mode this spec exists to prevent.
   */
  const readThemeProbe = (targetPage: Page): Promise<Record<string, string>> =>
    targetPage.evaluate(() => {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = window.getComputedStyle(document.body);
      return {
        dataBsTheme:
          document.documentElement.getAttribute('data-bs-theme') ?? '(unset)',
        bodyBackgroundColor: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        bsBodyBg: rootStyle.getPropertyValue('--bs-body-bg').trim(),
        bsBodyColor: rootStyle.getPropertyValue('--bs-body-color').trim(),
      };
    });

  /**
   * Switches the page to dark mode and returns the light/dark page-level
   * probe pair, having asserted that the two differ.
   */
  const switchToDarkMode = async (
    targetPage: Page,
  ): Promise<{
    light: Record<string, string>;
    dark: Record<string, string>;
  }> => {
    await setBsTheme(targetPage, 'light');
    const light = await readThemeProbe(targetPage);
    await setBsTheme(targetPage, 'dark');
    const dark = await readThemeProbe(targetPage);

    expect(dark.dataBsTheme).toBe('dark');
    expect(dark.bodyBackgroundColor).not.toBe(light.bodyBackgroundColor);
    expect(dark.bodyColor).not.toBe(light.bodyColor);

    return { light, dark };
  };

  test('Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualRefreshPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    const themeProbe = await switchToDarkMode(page);

    await expect
      .poll(async () =>
        page.evaluate(
          () => CSS.highlights.get('growi-inline-comment')?.size ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    await clickText(page, targetSentence);
    const popover = page.getByTestId('inline-comment-preview-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(originCommentText);
    await waitForPopoverToSettle(popover);

    fs.mkdirSync(evidenceDir, { recursive: true });
    await popover.screenshot({
      path: path.join(evidenceDir, '05-popover-normal-dark.png'),
    });
    writeMetrics('05-popover-normal-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-preview-popover"]',
        POPOVER_TARGETS,
      ),
      dividers: await collectDividers(page),
    });

    await popover
      .getByTestId('inline-comment-preview-popover-edit-button')
      .click();
    const editForm = popover.getByTestId(
      'inline-comment-preview-popover-edit-form',
    );
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('.cm-content')).toBeVisible();
    // Same fix as the light-mode capture above -- asserted here too.
    await expect(editForm.locator('.cm-content')).toContainText(
      originCommentText,
    );
    await waitForPopoverToSettle(popover);

    await popover.screenshot({
      path: path.join(evidenceDir, '06-popover-edit-dark.png'),
    });
    writeMetrics('06-popover-edit-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-preview-popover"]',
        POPOVER_TARGETS,
      ),
      dividers: await collectDividers(page),
    });
  });

  test('Capture list-item states 1-4 in DARK mode (Req 4.4)', async ({
    page,
  }, testInfo) => {
    await page.goto(visualRefreshPagePath(testInfo.retry));
    await disableCssTransitions(page);
    await expect(page.getByTestId('inline-comment-ready')).toBeAttached();
    const themeProbe = await switchToDarkMode(page);

    const item = page.getByTestId('inline-comment-item').first();
    await expect(item).toBeVisible();
    const card = item.locator('.page-comment').first();
    const editButton = item.getByTestId('inline-comment-edit-button');
    const deleteButton = item.getByTestId('inline-comment-delete-button');

    fs.mkdirSync(evidenceDir, { recursive: true });

    // --- State 1: normal (unresolved), hovered so the edit/delete icons show ---
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect(editButton).toBeVisible();
    await expect(deleteButton).toBeVisible();

    await card.screenshot({
      path: path.join(evidenceDir, '01-list-normal-dark.png'),
    });
    await page.screenshot({
      path: path.join(evidenceDir, '01-list-normal-fullpage-dark.png'),
      fullPage: true,
    });
    writeMetrics('01-list-normal-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    // --- State 2: edit mode ---
    await editButton.click();
    // 2026-09-11: origin editing now uses the literal same `CommentEditor`
    // the normal comment's own re-edit uses -- `.comment-form` is
    // `CommentEditorLayout`'s own plain wrapper class (no more
    // `.inline-comment-edit-form`).
    const editForm = item.locator('.comment-form');
    await expect(editForm).toBeVisible();
    await expect(editForm.locator('.cm-content')).toBeVisible();
    // Same fix as the light-mode capture above -- asserted here too.
    await expect(editForm.locator('.cm-content')).toContainText(
      originCommentText,
    );
    // Same reasoning as the light-mode capture above -- `card` no longer
    // resolves to the origin comment's box while editing, so use `item`.
    await item.hover();

    await item.screenshot({
      path: path.join(evidenceDir, '02-list-edit-dark.png'),
    });
    writeMetrics('02-list-edit-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    await item.locator('.btn-outline-neutral-secondary').first().click();
    await expect(editForm).not.toBeVisible();

    // --- State 3: delete confirmation (cancelled again right afterwards) ---
    await card.hover();
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    const deleteConfirm = item.getByTestId('inline-comment-delete-confirm');
    await expect(deleteConfirm).toBeVisible();
    await card.hover();

    await card.screenshot({
      path: path.join(evidenceDir, '03-list-delete-confirm-dark.png'),
    });
    writeMetrics('03-list-delete-confirm-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    await item.getByTestId('inline-comment-delete-cancel-button').click();
    await expect(deleteConfirm).not.toBeVisible();

    // --- State 4: resolved ---
    // 2026-09-11: same hover-first treatment as the light-mode capture above
    // -- the resolve/reopen toggle is now hover-revealed like edit/delete.
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await item.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Resolved',
    );
    await card.hover();
    await expect(editButton).toBeVisible();

    await card.screenshot({
      path: path.join(evidenceDir, '04-list-resolved-dark.png'),
    });
    writeMetrics('04-list-resolved-dark', {
      themeProbe,
      elements: await collectMetrics(
        page,
        '[data-testid="inline-comment-item"]',
        LIST_TARGETS,
      ),
    });

    // Same reasoning as the light-mode capture: leave the comment unresolved
    // so a retry of this serial group starts from the state the setup tests
    // created.
    await item.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(item.getByTestId('inline-comment-status')).toHaveText(
      'Unresolved',
    );
  });
});
