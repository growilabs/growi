import type { EditorState } from '@codemirror/state';

/**
 * Single conversion point that produces the text submitted to the AI from the
 * editor state (Requirements 6.1, 6.2, 6.3).
 *
 * Mentions are stored in the doc as their literal path string and only overlaid
 * with a replace-decoration for the chip display, so the doc text already holds
 * each path at its position and in order. Therefore the flattened text is simply
 * `state.doc.toString()`: it reflects every mention path inline in selection
 * order (6.1, 6.3) and never contains referenced-page body content (6.2).
 *
 * Keeping this as the only transformation means a future change to how chips are
 * represented in the doc would only need to touch this function.
 */
export const getMentionFlattenedText = (state: EditorState): string =>
  state.doc.toString();
