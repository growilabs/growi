import type { MentionController } from './types';

/**
 * Shared ARIA ids that wire the CodeMirror editor (the combobox-like textbox)
 * to the candidate listbox.
 *
 * Because keyboard focus stays on the editor (not a downshift input), the editor
 * itself carries `aria-controls`/`aria-activedescendant` pointing at the listbox
 * and the highlighted option. These ids must therefore be stable and agreed on
 * by both `PageMentionInput` (sets them on the editor) and `MentionCandidateList`
 * (renders the listbox + options with these ids).
 */
export const MENTION_LISTBOX_ID = 'page-mention-candidate-listbox';

/** Deterministic option id for the candidate at `index` within the listbox. */
export const mentionOptionId = (index: number): string =>
  `${MENTION_LISTBOX_ID}-option-${index}`;

/**
 * Single predicate for "the candidate listbox (and its option rows) is
 * actually in the DOM": open session + non-empty query + settled search +
 * at least one candidate.
 *
 * Shared by `MentionCandidateList` (renders the listbox under exactly this
 * condition; the hint / searching / no-results states show a status row with
 * no listbox) and `PageMentionInput` (emits `aria-controls` /
 * `aria-activedescendant` only while the referenced ids exist, so they never
 * dangle).
 */
export const isListboxRendered = (
  controller: Pick<
    MentionController,
    'isOpen' | 'query' | 'isLoading' | 'candidates'
  >,
): boolean =>
  controller.isOpen &&
  controller.query.length >= 1 &&
  !controller.isLoading &&
  controller.candidates.length > 0;
