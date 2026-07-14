import { insertNewlineAndIndent } from '@codemirror/commands';
import type { Extension } from '@codemirror/state';
import { Facet, Prec } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';
import { type EditorView, keymap } from '@codemirror/view';

import type { MentionController } from '../types';

/**
 * Getter for the current mention controller.
 *
 * The keymap must always see the *latest* controller, not the one captured at
 * editor-creation time (stale closure / Issue 1). React holds the controller in
 * a stable ref and provides this facet with a getter over that ref, so reading
 * `facet(...)()` on each keypress resolves the current controller instance.
 */
type MentionControllerGetter = () => MentionController | null;

/**
 * Single-provider facet holding a getter for the current controller.
 * Defaults to a getter returning `null` when no provider is registered.
 */
export const mentionControllerFacet = Facet.define<
  MentionControllerGetter,
  MentionControllerGetter
>({
  combine: (inputs) => inputs[0] ?? (() => null),
});

const resolveController = (view: EditorView): MentionController | null => {
  const getController = view.state.facet(mentionControllerFacet);
  return getController();
};

/** ArrowDown: while open, move the highlight down and consume the key. */
export const mentionArrowDown: Command = (view) => {
  const controller = resolveController(view);
  if (controller?.isOpen !== true) {
    return false;
  }
  controller.moveDown();
  return true;
};

/** ArrowUp: while open, move the highlight up and consume the key. */
export const mentionArrowUp: Command = (view) => {
  const controller = resolveController(view);
  if (controller?.isOpen !== true) {
    return false;
  }
  controller.moveUp();
  return true;
};

/** Escape: while open, close the panel and consume the key. */
export const mentionEscape: Command = (view) => {
  const controller = resolveController(view);
  if (controller?.isOpen !== true) {
    return false;
  }
  controller.close();
  return true;
};

/** Tab: while open, commit the highlighted candidate. Otherwise do not trap Tab. */
export const mentionTab: Command = (view) => {
  const controller = resolveController(view);
  if (controller?.isOpen !== true) {
    return false;
  }
  controller.commit();
  return true;
};

/**
 * Enter:
 *  1. While IME composition is in progress (`view.composing`), pass the key
 *     through untouched so the IME confirms the conversion — never commit nor
 *     submit (Issue 2, GROWI is Japanese-first).
 *  2. Else, if the panel is open, commit the highlighted candidate.
 *  3. Else, submit the host form (same pipeline as the existing textarea).
 */
export const mentionEnter: Command = (view) => {
  // IME composing guard applies regardless of panel state.
  if (view.composing) {
    return false;
  }

  const controller = resolveController(view);
  if (controller?.isOpen === true) {
    controller.commit();
    return true;
  }

  const form = view.dom.closest('form');
  if (form == null) {
    return false;
  }
  form.requestSubmit();
  return true;
};

/** Shift-Enter: insert a newline (multiline chat input); never submit. */
export const mentionShiftEnter: Command = (view) => {
  return insertNewlineAndIndent(view);
};

const bindings: readonly KeyBinding[] = [
  { key: 'ArrowDown', run: mentionArrowDown },
  { key: 'ArrowUp', run: mentionArrowUp },
  { key: 'Escape', run: mentionEscape },
  { key: 'Tab', run: mentionTab },
  { key: 'Enter', run: mentionEnter },
  { key: 'Shift-Enter', run: mentionShiftEnter },
];

/**
 * High-priority keymap delegating navigation keys to the mention controller
 * during a session, and routing Enter to host-form submission otherwise.
 * `Prec.highest` ensures these win over CodeMirror's default keymaps.
 */
export const mentionKeymap: Extension = Prec.highest(keymap.of([...bindings]));
