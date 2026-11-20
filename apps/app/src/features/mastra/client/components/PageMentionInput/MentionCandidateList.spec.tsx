import { fireEvent, render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { MentionCandidateList } from './MentionCandidateList';
import { MENTION_LISTBOX_ID, mentionOptionId } from './mention-aria';
import type { MentionController, PagePathCandidate } from './types';

// i18n: return the key itself so assertions can target the stable key string
// (mastra components use react-i18next's useTranslation, default namespace).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const candidate = (pageId: string, path: string): PagePathCandidate => ({
  pageId,
  path,
});

/**
 * Build a controller mock with sensible open defaults, overridable per-test.
 */
const buildController = (
  overrides: Partial<MentionController> = {},
): MentionController =>
  mock<MentionController>({
    isOpen: true,
    query: '',
    highlightedIndex: 0,
    candidates: [],
    isLoading: false,
    // Explicit no-op spies so each test sees real, assertable callbacks even
    // when it doesn't override them (rather than relying on auto-stubbing).
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    setHighlightedIndex: vi.fn(),
    commit: vi.fn(),
    close: vi.fn(),
    ...overrides,
  });

describe('MentionCandidateList', () => {
  describe('visibility', () => {
    it('renders nothing when the controller is closed', () => {
      const controller = buildController({ isOpen: false, query: 'foo' });
      const { container } = render(
        <MentionCandidateList controller={controller} />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('4-state display (1.1 / 1.2 / 1.4 / 2.1 / 2.5 / 2.6)', () => {
    it('shows the hint and NO candidates when the query is empty (1.1 / 1.2)', () => {
      const controller = buildController({
        query: '',
        candidates: [candidate('id-a', '/foo/a')],
      });
      render(<MentionCandidateList controller={controller} />);

      expect(screen.getByText('pageMention.hint')).toBeInTheDocument();
      // Empty query must not surface candidates even if some are present.
      expect(screen.queryByText('/foo/a')).not.toBeInTheDocument();
      expect(
        screen.queryByText('pageMention.searching'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('pageMention.noResults'),
      ).not.toBeInTheDocument();
    });

    it('shows the loading row while searching (2.5)', () => {
      const controller = buildController({ query: 'foo', isLoading: true });
      render(<MentionCandidateList controller={controller} />);

      expect(screen.getByText('pageMention.searching')).toBeInTheDocument();
      expect(screen.queryByText('pageMention.hint')).not.toBeInTheDocument();
    });

    it('shows the no-results row when not loading and the result is empty (2.6)', () => {
      const controller = buildController({
        query: 'foo',
        isLoading: false,
        candidates: [],
      });
      render(<MentionCandidateList controller={controller} />);

      expect(screen.getByText('pageMention.noResults')).toBeInTheDocument();
    });

    it('renders each candidate path as a row (1.4 / 2.1)', () => {
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a'), candidate('id-b', '/foo/b')],
      });
      render(<MentionCandidateList controller={controller} />);

      expect(screen.getByText('/foo/a')).toBeInTheDocument();
      expect(screen.getByText('/foo/b')).toBeInTheDocument();
      expect(
        screen.queryByText('pageMention.noResults'),
      ).not.toBeInTheDocument();
    });
  });

  describe('highlight (2.2 reflection)', () => {
    it('marks the row at highlightedIndex as selected', () => {
      const controller = buildController({
        query: 'foo',
        highlightedIndex: 1,
        candidates: [candidate('id-a', '/foo/a'), candidate('id-b', '/foo/b')],
      });
      render(<MentionCandidateList controller={controller} />);

      const rowA = screen.getByText('/foo/a').closest('[role="option"]');
      const rowB = screen.getByText('/foo/b').closest('[role="option"]');

      expect(rowA).toHaveAttribute('aria-selected', 'false');
      expect(rowB).toHaveAttribute('aria-selected', 'true');
    });

    it('highlights an item on mouse hover via the controller (2.2)', () => {
      const setHighlightedIndex = vi.fn();
      const controller = buildController({
        query: 'foo',
        highlightedIndex: 0,
        candidates: [candidate('id-a', '/foo/a'), candidate('id-b', '/foo/b')],
        setHighlightedIndex,
      });
      render(<MentionCandidateList controller={controller} />);

      const rowB = screen.getByText('/foo/b').closest('[role="option"]');
      if (rowB == null) {
        throw new Error('row B [role="option"] not found');
      }
      // Hovering moves downshift's highlight, synced back to the controller.
      fireEvent.mouseMove(rowB);

      expect(setHighlightedIndex).toHaveBeenCalledWith(1);
    });

    it('scrolls the initially highlighted row into view on first render (2.2)', () => {
      // WHY (mechanism proxy): happy-dom has no layout, so "the row is actually
      // visible" cannot be observed. We assert scrollIntoView is invoked as a
      // proxy; real visibility is covered by the manual smoke test (task 7.1).
      const scrollIntoView = vi
        .spyOn(HTMLElement.prototype, 'scrollIntoView')
        .mockImplementation(() => {});

      render(
        <MentionCandidateList
          controller={buildController({
            query: 'foo',
            highlightedIndex: 1,
            candidates: [
              candidate('id-a', '/foo/a'),
              candidate('id-b', '/foo/b'),
            ],
          })}
        />,
      );

      // Even without a highlight *change*, the initially highlighted row must
      // be brought into view.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      scrollIntoView.mockRestore();
    });

    it('scrolls the highlighted row into view when the highlight changes (2.2)', () => {
      // WHY (mechanism proxy): see the first-render test above — happy-dom has
      // no layout, so scrollIntoView invocation is the observable proxy; real
      // visibility is covered by the manual smoke test (task 7.1).
      const scrollIntoView = vi
        .spyOn(HTMLElement.prototype, 'scrollIntoView')
        .mockImplementation(() => {});

      const candidates = [
        candidate('id-a', '/foo/a'),
        candidate('id-b', '/foo/b'),
      ];
      const { rerender } = render(
        <MentionCandidateList
          controller={buildController({
            query: 'foo',
            highlightedIndex: 0,
            candidates,
          })}
        />,
      );

      // Move the highlight; the newly highlighted row scrolls into view (the
      // SimpleBar wrapper scrolls, since downshift's own scroll is disabled).
      rerender(
        <MentionCandidateList
          controller={buildController({
            query: 'foo',
            highlightedIndex: 1,
            candidates,
          })}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      scrollIntoView.mockRestore();
    });
  });

  describe('commit on row click (2.3)', () => {
    it('calls commit with the clicked row index', () => {
      const commit = vi.fn();
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a'), candidate('id-b', '/foo/b')],
        commit,
      });
      render(<MentionCandidateList controller={controller} />);

      fireEvent.click(screen.getByText('/foo/b'));

      expect(commit).toHaveBeenCalledWith(1);
    });
  });

  describe('outside-click dismissal (2.4)', () => {
    it('calls close when a mousedown lands outside the panel', () => {
      const close = vi.fn();
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a')],
        close,
      });
      render(<MentionCandidateList controller={controller} />);

      fireEvent.mouseDown(document.body);

      expect(close).toHaveBeenCalledTimes(1);
    });

    it('does NOT call close when the mousedown lands inside the panel', () => {
      const close = vi.fn();
      const commit = vi.fn();
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a')],
        close,
        commit,
      });
      render(<MentionCandidateList controller={controller} />);

      fireEvent.mouseDown(screen.getByText('/foo/a'));

      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('ARIA wiring (#10 / #15 / #16)', () => {
    it('labels the listbox and gives it the shared id (#16)', () => {
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a')],
      });
      render(<MentionCandidateList controller={controller} />);

      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('id', MENTION_LISTBOX_ID);
      expect(listbox).toHaveAttribute(
        'aria-label',
        'pageMention.candidatesLabel',
      );
    });

    it('gives each option the deterministic id referenced by aria-activedescendant (#10)', () => {
      const controller = buildController({
        query: 'foo',
        candidates: [candidate('id-a', '/foo/a'), candidate('id-b', '/foo/b')],
      });
      render(<MentionCandidateList controller={controller} />);

      expect(
        screen.getByText('/foo/a').closest('[role="option"]'),
      ).toHaveAttribute('id', mentionOptionId(0));
      expect(
        screen.getByText('/foo/b').closest('[role="option"]'),
      ).toHaveAttribute('id', mentionOptionId(1));
    });

    it('exposes the empty-query hint as a polite live region (#15)', () => {
      const controller = buildController({ query: '', candidates: [] });
      render(<MentionCandidateList controller={controller} />);

      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('pageMention.hint');
      expect(status).toHaveAttribute('aria-live', 'polite');
    });
  });
});
