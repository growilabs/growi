import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Task 1.3 of inline-comment-visual-consistency (Requirement 11.6) adds the
 * translation keys the visual-consistency rework's JSX will call via
 * `t('inline_comment.*')` (start-comment button, resolved/unresolved badge,
 * resolve/reopen toggle). This repo is English-first (see project memory):
 * only `en_US` is required for now, other locales are deferred.
 *
 * `label` (the "Inline Comment" type-label row) was removed once the
 * approved visual-refresh mockup showed no such row.
 *
 * Task 1.3 of inline-comment-interaction-ux (Requirements 2.3, 3.2) adds one
 * more key ahead of the component that will consume it (task 4.1): the toast
 * shown when a list item's scroll-to-range fails because the comment's
 * anchor could not be re-resolved. The popover's submit button (task 3.2)
 * is left to follow the existing `page_comment.comment` submit-button
 * convention, as `CommentEditor.tsx` and `InlineCommentForm.tsx` already do;
 * `page_comment.reply` is a different key, reused only by task 4.1's
 * list-side "Reply..." toggle button per design.md 決定5. The popover's
 * close affordance reuses the existing top-level `Close` key. None of these
 * reused keys are duplicated here.
 *
 * `reply_placeholder` was added here ahead of the popover's reply textarea,
 * back when Requirement 15.3 only called for "a simple input field" with no
 * further UI spec. Requirement 17 (added later) replaced that simple input
 * with the same mention-aware `MentionAwareCommentInput` component the
 * normal comment reply uses (Req 17.2/17.4) — a CodeMirror editor with no
 * placeholder prop, matching the normal comment reply UI, which also has no
 * placeholder. No acceptance criterion calls for placeholder text, so the
 * key was never wired up; removed as unused (caught by `lint:i18n`'s
 * unused-key check).
 */

const INLINE_COMMENT_KEYS = [
  'start_comment',
  'resolved',
  'unresolved',
  'resolve',
  'reopen',
  'range_not_found',
] as const;

const translationJsonPath = path.resolve(
  import.meta.dirname,
  '../../../../public/static/locales/en_US/translation.json',
);

describe('en_US translation.json has the inline_comment.* keys', () => {
  const translation = JSON.parse(
    fs.readFileSync(translationJsonPath, 'utf-8'),
  ) as Record<string, unknown>;

  it.each(
    INLINE_COMMENT_KEYS,
  )('inline_comment.%s resolves to a non-empty string', (key) => {
    const namespace = translation.inline_comment as
      | Record<string, unknown>
      | undefined;
    const value = namespace?.[key];

    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });
});
