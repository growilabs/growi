// @vitest-environment happy-dom

import { EditorView } from '@codemirror/view';
import { act, render } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';

import { addMention } from './editor-state/mention-decoration';
import { MENTION_LISTBOX_ID, mentionOptionId } from './mention-aria';
import { PageMentionInput } from './PageMentionInput';

// --- Search store mock (the data boundary) ---------------------------------
// useMentionController (rendered inside PageMentionInput) calls useSWRxSearch.
// Stub it with a controllable return so a test can make candidates appear.
const { searchState } = vi.hoisted(() => ({
  searchState: {
    current: {
      data: undefined as IFormattedSearchResult | undefined,
      isLoading: false,
    },
  },
}));
vi.mock('~/stores/search', () => ({
  useSWRxSearch: () => searchState.current,
}));

/** Build a minimal, type-safe search result with the given page paths. */
const setSearchResult = (
  pages: ReadonlyArray<{ id: string; path: string }>,
): void => {
  searchState.current = {
    data: mock<IFormattedSearchResult>({
      data: pages.map((p) =>
        mock<IPageWithSearchMeta>({
          data: mock<IPageWithSearchMeta['data']>({ _id: p.id, path: p.path }),
        }),
      ),
    }),
    isLoading: false,
  };
};

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
  beforeEach(() => {
    searchState.current = { data: undefined, isLoading: false };
  });

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

  describe('placeholder', () => {
    const placeholderText = (container: HTMLElement): string | undefined =>
      container.querySelector<HTMLElement>('.cm-placeholder')?.textContent ??
      undefined;

    it('renders the given placeholder while the doc is empty', () => {
      const { container } = render(
        <PageMentionInput value="" onChange={vi.fn()} placeholder="first" />,
      );

      expect(placeholderText(container)).toBe('first');
    });

    it('follows a placeholder prop change after mount (async i18n / locale switch)', () => {
      const { container, rerender } = render(
        <PageMentionInput value="" onChange={vi.fn()} placeholder="first" />,
      );
      expect(placeholderText(container)).toBe('first');

      rerender(
        <PageMentionInput value="" onChange={vi.fn()} placeholder="second" />,
      );

      expect(placeholderText(container)).toBe('second');
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

  describe('combobox ARIA wiring (#10 / #2)', () => {
    // The combobox relationship must point at the listbox/option ids only while
    // those elements are actually rendered. Use fake timers to drive the search
    // debounce deterministically (typing → "searching" → settled listbox).
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      // A debounce timer scheduled by the last interaction may still be
      // pending; flushing it triggers React state updates, so wrap in act()
      // to keep the flush inside React's update cycle (no act() warning).
      act(() => {
        vi.runOnlyPendingTimers();
      });
      vi.useRealTimers();
    });

    it('references the listbox only once it renders (>= 1 candidate), then clears on close', () => {
      setSearchResult([{ id: 'p1', path: '/docs/foo' }]);
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

      // During the debounce window the panel shows "searching" (no listbox yet),
      // so the editor must not reference a not-yet-rendered listbox (#2).
      expect(view.contentDOM.getAttribute('aria-controls')).toBeNull();

      // Flush the debounce: the search settles, the listbox + options render,
      // and only now does the editor point at them.
      act(() => {
        vi.runAllTimers();
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

    it('never references a non-existent listbox in the hint / no-results states (#2)', () => {
      // No candidates configured → the search settles to the no-results state.
      const { container } = render(
        <PageMentionInput value="" onChange={vi.fn()} />,
      );
      const view = getView(container);

      // Empty-query hint: session is open but only a hint row shows (no listbox).
      act(() => {
        view.dispatch({
          changes: { from: 0, insert: '@' },
          selection: { anchor: 1 },
        });
      });
      act(() => {
        vi.runAllTimers();
      });
      expect(view.contentDOM.getAttribute('aria-controls')).toBeNull();
      expect(view.contentDOM.getAttribute('aria-activedescendant')).toBeNull();

      // No-results: a query is present but the search returns nothing. Still no
      // listbox in the DOM, so still no dangling references.
      act(() => {
        view.dispatch({
          changes: { from: 1, insert: 'foo' },
          selection: { anchor: 4 },
        });
      });
      act(() => {
        vi.runAllTimers();
      });
      expect(view.contentDOM.getAttribute('aria-controls')).toBeNull();
      expect(view.contentDOM.getAttribute('aria-activedescendant')).toBeNull();
    });
  });
});
