import type { EditorView } from '@codemirror/view';
import { mock } from 'vitest-mock-extended';

import type { MentionController } from '../types';
import {
  mentionArrowDown,
  mentionArrowUp,
  mentionControllerFacet,
  mentionEnter,
  mentionEscape,
  mentionShiftEnter,
  mentionTab,
} from './mention-keymap';

const { insertNewlineAndIndentMock } = vi.hoisted(() => ({
  insertNewlineAndIndentMock: vi.fn<(view: EditorView) => boolean>(),
}));

vi.mock('@codemirror/commands', () => ({
  insertNewlineAndIndent: (view: EditorView) =>
    insertNewlineAndIndentMock(view),
}));

/**
 * Build a `state.facet` stub that resolves the mention-controller facet to the
 * given getter. `facet` is an overloaded generic function that a single
 * simplified stub cannot satisfy structurally, so the unavoidable cast is
 * localized here and reused by every view mock below.
 */
const facetStub = (
  resolveController: () => MentionController | null,
): EditorView['state']['facet'] =>
  ((facet: unknown) =>
    facet === mentionControllerFacet
      ? resolveController
      : undefined) as EditorView['state']['facet'];

/**
 * Build a mock EditorView whose state.facet returns a getter for the given
 * controller. `composing` mirrors CodeMirror's IME composition flag.
 * `requestSubmit` is exposed so the non-session Enter path can be asserted.
 */
const buildView = (opts: {
  controller: MentionController | null;
  composing?: boolean;
  requestSubmit?: () => void;
  hasForm?: boolean;
}): EditorView => {
  const { controller, composing = false, requestSubmit, hasForm = true } = opts;
  const form = hasForm ? { requestSubmit: requestSubmit ?? vi.fn() } : null;

  return mock<EditorView>({
    composing,
    state: { facet: facetStub(() => controller) },
    dom: {
      // `closest` is an overloaded generic too; localize its cast to this field.
      closest: ((selector: string) =>
        selector === 'form' ? form : null) as HTMLElement['closest'],
    },
  });
};

const buildController = (
  overrides: Partial<MentionController> = {},
): MentionController =>
  mock<MentionController>({
    isOpen: true,
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    commit: vi.fn(),
    close: vi.fn(),
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mention-keymap commands', () => {
  describe('session active (panel open)', () => {
    it('ArrowDown delegates to moveDown and consumes the key', () => {
      const controller = buildController({ isOpen: true });
      const view = buildView({ controller });

      const handled = mentionArrowDown(view);

      expect(handled).toBe(true);
      expect(controller.moveDown).toHaveBeenCalledTimes(1);
    });

    it('ArrowUp delegates to moveUp and consumes the key', () => {
      const controller = buildController({ isOpen: true });
      const view = buildView({ controller });

      const handled = mentionArrowUp(view);

      expect(handled).toBe(true);
      expect(controller.moveUp).toHaveBeenCalledTimes(1);
    });

    it('Escape delegates to close and consumes the key', () => {
      const controller = buildController({ isOpen: true });
      const view = buildView({ controller });

      const handled = mentionEscape(view);

      expect(handled).toBe(true);
      expect(controller.close).toHaveBeenCalledTimes(1);
    });

    it('Tab delegates to commit and consumes the key', () => {
      const controller = buildController({ isOpen: true });
      const view = buildView({ controller });

      const handled = mentionTab(view);

      expect(handled).toBe(true);
      expect(controller.commit).toHaveBeenCalledTimes(1);
    });

    it('Enter delegates to commit and consumes the key (no submit)', () => {
      const controller = buildController({ isOpen: true });
      const requestSubmit = vi.fn();
      const view = buildView({ controller, requestSubmit });

      const handled = mentionEnter(view);

      expect(handled).toBe(true);
      expect(controller.commit).toHaveBeenCalledTimes(1);
      expect(requestSubmit).not.toHaveBeenCalled();
    });
  });

  describe('session inactive (panel closed)', () => {
    it('ArrowDown returns false and does not touch the controller', () => {
      const controller = buildController({ isOpen: false });
      const view = buildView({ controller });

      expect(mentionArrowDown(view)).toBe(false);
      expect(controller.moveDown).not.toHaveBeenCalled();
    });

    it('ArrowUp returns false and does not touch the controller', () => {
      const controller = buildController({ isOpen: false });
      const view = buildView({ controller });

      expect(mentionArrowUp(view)).toBe(false);
      expect(controller.moveUp).not.toHaveBeenCalled();
    });

    it('Escape returns false and does not touch the controller', () => {
      const controller = buildController({ isOpen: false });
      const view = buildView({ controller });

      expect(mentionEscape(view)).toBe(false);
      expect(controller.close).not.toHaveBeenCalled();
    });

    it('Tab returns false and does not trap the key', () => {
      const controller = buildController({ isOpen: false });
      const view = buildView({ controller });

      expect(mentionTab(view)).toBe(false);
      expect(controller.commit).not.toHaveBeenCalled();
    });

    it('Enter submits the host form via requestSubmit and consumes the key', () => {
      const controller = buildController({ isOpen: false });
      const requestSubmit = vi.fn();
      const view = buildView({ controller, requestSubmit });

      const handled = mentionEnter(view);

      expect(handled).toBe(true);
      expect(requestSubmit).toHaveBeenCalledTimes(1);
      expect(controller.commit).not.toHaveBeenCalled();
    });

    it('Enter returns false when there is no host form to submit', () => {
      const controller = buildController({ isOpen: false });
      const view = buildView({ controller, hasForm: false });

      expect(mentionEnter(view)).toBe(false);
    });
  });

  describe('IME composition guard (Enter)', () => {
    it('passes through (returns false) without commit while composing and open', () => {
      const controller = buildController({ isOpen: true });
      const requestSubmit = vi.fn();
      const view = buildView({ controller, composing: true, requestSubmit });

      const handled = mentionEnter(view);

      expect(handled).toBe(false);
      expect(controller.commit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
    });

    it('passes through (returns false) without submit while composing and closed', () => {
      const controller = buildController({ isOpen: false });
      const requestSubmit = vi.fn();
      const view = buildView({ controller, composing: true, requestSubmit });

      const handled = mentionEnter(view);

      expect(handled).toBe(false);
      expect(controller.commit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
    });
  });

  describe('controller access', () => {
    it('reads the current controller from the facet getter (no stale capture)', () => {
      const first = buildController({ isOpen: false });
      const second = buildController({ isOpen: true });
      // Same view object, but the facet getter resolves a different controller.
      let current: MentionController = first;
      const view = mock<EditorView>({
        composing: false,
        state: { facet: facetStub(() => current) },
      });

      expect(mentionArrowDown(view)).toBe(false);
      expect(first.moveDown).not.toHaveBeenCalled();

      current = second;
      expect(mentionArrowDown(view)).toBe(true);
      expect(second.moveDown).toHaveBeenCalledTimes(1);
    });

    it('returns false when no controller is provided', () => {
      const view = buildView({ controller: null });
      expect(mentionArrowDown(view)).toBe(false);
      expect(mentionEscape(view)).toBe(false);
    });
  });

  describe('Shift-Enter', () => {
    it('inserts a newline and never submits', () => {
      const controller = buildController({ isOpen: false });
      const requestSubmit = vi.fn();
      const view = buildView({ controller, requestSubmit });
      insertNewlineAndIndentMock.mockReturnValue(true);

      const handled = mentionShiftEnter(view);

      expect(handled).toBe(true);
      expect(insertNewlineAndIndentMock).toHaveBeenCalledWith(view);
      expect(requestSubmit).not.toHaveBeenCalled();
      expect(controller.commit).not.toHaveBeenCalled();
    });
  });
});
