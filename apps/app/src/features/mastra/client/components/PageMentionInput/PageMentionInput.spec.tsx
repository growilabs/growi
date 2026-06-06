// @vitest-environment happy-dom

import { EditorView } from '@codemirror/view';
import { act, render } from '@testing-library/react';

import { addMention } from './editor-state/mention-decoration';
import { MENTION_LISTBOX_ID, mentionOptionId } from './mention-aria';
import { PageMentionInput } from './PageMentionInput';

// --- Search store mock (the data boundary) ---------------------------------
// useMentionController (rendered inside PageMentionInput) calls useSWRxSearch.
// Stub it so the component renders without a real network/SWR dependency.
vi.mock('~/stores/search', () => ({
  useSWRxSearch: () => ({ data: undefined, isLoading: false }),
}));

// i18n: return the key itself (MentionCandidateList consumes useTranslation).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// next/router: chip-click navigation uses router.push (SPA navigation, 4.1).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

/** Query the hidden form field that carries the submitted message text (6.1). */
const hiddenMessageInput = (): HTMLInputElement | null =>
  document.querySelector('input[name="message"]');

/** Locate the live EditorView instance mounted inside the rendered container. */
const getView = (container: HTMLElement): EditorView => {
  const dom = container.querySelector<HTMLElement>('.cm-editor');
  if (dom == null) {
    throw new Error('EditorView DOM (.cm-editor) not found');
  }
  const view = EditorView.findFromDOM(dom);
  if (view == null) {
    throw new Error('EditorView instance not found from DOM');
  }
  return view;
};

describe('PageMentionInput', () => {
  describe('hidden form field (6.1)', () => {
    it('renders a hidden input[name="message"]', () => {
      render(<PageMentionInput value="" onChange={vi.fn()} />);

      const input = hiddenMessageInput();
      expect(input).not.toBeNull();
      expect(input?.type).toBe('hidden');
    });
  });

  describe('doc → parent + hidden input (6.1)', () => {
    it('calls onChange with the flattened text and syncs the hidden input on doc change', () => {
      const onChange = vi.fn();
      const { container } = render(
        <PageMentionInput value="" onChange={onChange} />,
      );

      // Reach the live EditorView and dispatch a doc change (no layout needed).
      const view = getView(container);
      act(() => {
        view.dispatch({ changes: { from: 0, insert: '/foo/bar' } });
      });

      expect(onChange).toHaveBeenCalledWith('/foo/bar');
      expect(hiddenMessageInput()?.value).toBe('/foo/bar');
    });
  });

  describe('value → doc reset (external reset only)', () => {
    it('clears the editor doc when value becomes empty', () => {
      const onChange = vi.fn();
      // Parent keeps `value` in sync with the flattened text (the real flow).
      const { container, rerender } = render(
        <PageMentionInput value="/foo/bar" onChange={onChange} />,
      );

      const view = getView(container);
      act(() => {
        view.dispatch({ changes: { from: 0, insert: '/foo/bar' } });
      });
      expect(view.state.doc.toString()).toBe('/foo/bar');

      // External reset (post-submit clear): value transitions to '' → doc empties.
      rerender(<PageMentionInput value="" onChange={onChange} />);

      expect(view.state.doc.toString()).toBe('');
    });

    it('does NOT reset the doc on a steady empty value (only on the non-empty→empty transition)', () => {
      // Mount with an empty value; the parent never sets a non-empty value here.
      const { container, rerender } = render(
        <PageMentionInput value="" onChange={vi.fn()} />,
      );

      const view = getView(container);
      act(() => {
        view.dispatch({ changes: { from: 0, insert: '/typed' } });
      });
      expect(view.state.doc.toString()).toBe('/typed');

      // Re-render with the SAME empty value (no non-empty→empty transition):
      // editor-driven content must be preserved (guards the prevValue check).
      rerender(<PageMentionInput value="" onChange={vi.fn()} />);

      expect(view.state.doc.toString()).toBe('/typed');
    });
  });

  describe('lifecycle', () => {
    it('mounts and unmounts without throwing, destroying the view', () => {
      const { unmount, container } = render(
        <PageMentionInput value="" onChange={vi.fn()} />,
      );
      const view = getView(container);
      const destroySpy = vi.spyOn(view, 'destroy');

      expect(() => unmount()).not.toThrow();
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  describe('navigation wiring (4.1)', () => {
    it('navigates to the referenced page path via Next.js routing when a chip is clicked', () => {
      pushMock.mockClear();

      const { container } = render(
        <PageMentionInput value="" onChange={vi.fn()} />,
      );

      const view = getView(container);
      const path = '/foo/bar';
      // Insert the path and register an atomic mention chip over its range.
      act(() => {
        view.dispatch({
          changes: { from: 0, insert: path },
          effects: addMention.of({ from: 0, to: path.length, data: { path } }),
        });
      });

      const chip = container.querySelector<HTMLElement>('[data-mention]');
      expect(chip).not.toBeNull();
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // SPA navigation via Next.js router (not a new tab).
      expect(pushMock).toHaveBeenCalledWith(path);
    });
  });

  describe('combobox ARIA wiring (#10)', () => {
    it('sets aria-controls / aria-activedescendant on the editor while a session is open, and clears them when closed', () => {
      const { container } = render(
        <PageMentionInput value="" onChange={vi.fn()} />,
      );
      const view = getView(container);

      // No session yet → no combobox relationship.
      expect(view.contentDOM.getAttribute('aria-controls')).toBeNull();
      expect(view.contentDOM.getAttribute('aria-activedescendant')).toBeNull();

      // Type "@foo" to open a mention session at the line-start boundary.
      act(() => {
        view.dispatch({
          changes: { from: 0, insert: '@foo' },
          selection: { anchor: 4 },
        });
      });

      expect(view.contentDOM.getAttribute('aria-controls')).toBe(
        MENTION_LISTBOX_ID,
      );
      expect(view.contentDOM.getAttribute('aria-activedescendant')).toBe(
        mentionOptionId(0),
      );

      // Deleting the "@" closes the session → relationship is cleared.
      act(() => {
        view.dispatch({ changes: { from: 0, to: 4, insert: '' } });
      });

      expect(view.contentDOM.getAttribute('aria-controls')).toBeNull();
      expect(view.contentDOM.getAttribute('aria-activedescendant')).toBeNull();
    });
  });
});
