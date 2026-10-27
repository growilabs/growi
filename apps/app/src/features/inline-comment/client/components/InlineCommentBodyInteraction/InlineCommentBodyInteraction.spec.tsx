// @vitest-environment happy-dom

/**
 * Unit tests for task 3.3: combining the hit-test hook (3.1) with the
 * preview popover (3.2) and wiring their open/close policy (design.md 決定2,
 * requirements.md Requirement 2, ACs 2.1-2.6).
 *
 * Also covers the hover show/hide delay and pointer-enter-into-popover lock
 * (requirements.md Requirement 15, ACs 15.7-15.9).
 *
 * `useHighlightHitTest` and `rangesById` are both mocked -- their own
 * behavior is covered by their own specs (3.1, resolved-range.spec.ts). This
 * file only verifies the policy this component itself owns: which comment id
 * (if any) gets a popover, and the click-pinning behavior documented in
 * tasks.md's Implementation Notes (a click-opened popover must survive the
 * hook's hit clearing back to `null` once the pointer leaves the highlight).
 *
 * `InlineCommentPreviewPopover` is mocked to a minimal stand-in exposing the
 * props it was given plus a close button -- its own rendering/positioning/
 * reply-submission behavior is task 3.2's concern, not this one's. It also
 * exposes an "enter popover" button and a "resolve" button that invoke the
 * `onPointerEnter` and `resolve` props respectively, so the hover-lock
 * promotion and the resolve-threading wiring (this component's own concerns)
 * can both be exercised here.
 */

import type { RefObject } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Matches InlineCommentBodyInteraction.tsx's HOVER_SHOW_DELAY_MS/
// HOVER_HIDE_DELAY_MS local constants (research.md's "Debounce timing
// constants" decision). Kept as separate literals here (not imported) so a
// test asserting the actual delay would fail if the component's constants
// ever drifted from these values unnoticed.
const HOVER_SHOW_DELAY_MS = 150;
const HOVER_HIDE_DELAY_MS = 250;

import type { RendererOptions } from '~/interfaces/renderer-options';

import type {
  InlineCommentWithReplies,
  ResolvedRange,
} from '../../../interfaces';
import type { HighlightHit, HitTestTarget } from './use-highlight-hit-test';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockedUseHighlightHitTest = vi.fn<() => HighlightHit | null>(() => null);
vi.mock('./use-highlight-hit-test', () => ({
  useHighlightHitTest: () => mockedUseHighlightHitTest(),
}));

const mockedRangesById =
  vi.fn<
    (
      container: HTMLElement,
      resolvedRanges: ReadonlyMap<string, ResolvedRange>,
    ) => ReadonlyMap<string, HitTestTarget>
  >();
vi.mock('../../services/resolved-range', () => ({
  rangesById: (
    container: HTMLElement,
    resolvedRanges: ReadonlyMap<string, ResolvedRange>,
  ) => mockedRangesById(container, resolvedRanges),
}));

type PreviewPopoverProps = {
  comment: InlineCommentWithReplies;
  range: unknown;
  rendererOptions: RendererOptions | undefined;
  createReply: (parentId: string, comment: string) => Promise<unknown>;
  resolve: (id: string, resolved: boolean) => Promise<unknown>;
  update: (id: string, comment: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  updateReply: (id: string, comment: string) => Promise<unknown>;
  removeReply: (id: string) => Promise<unknown>;
  onClose: () => void;
  onPointerEnter: () => void;
};
const previewPopoverSpy = vi.fn<(props: PreviewPopoverProps) => void>();
vi.mock('./InlineCommentPreviewPopover', () => ({
  InlineCommentPreviewPopover: (props: PreviewPopoverProps) => {
    previewPopoverSpy(props);
    return (
      <div data-testid="preview-popover">
        <span data-testid="preview-popover-comment-id">{props.comment.id}</span>
        <button type="button" onClick={props.onClose}>
          close
        </button>
        <button type="button" onClick={props.onPointerEnter}>
          enter popover
        </button>
        <button
          type="button"
          onClick={() => props.resolve(props.comment.id, true)}
        >
          resolve
        </button>
      </div>
    );
  },
}));

import { InlineCommentBodyInteraction } from './InlineCommentBodyInteraction';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'comment1',
  pageId: 'page1',
  creatorId: 'user1',
  creator: null,
  comment: 'the comment body',
  anchorOriginRevisionId: 'revision1',
  anchor: { quote: 'q', prefix: '', suffix: '', approxOffset: 0 },
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  replies: [],
  ...overrides,
});

const rendererOptions: RendererOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
  components: {},
};

// A minimal structural stand-in -- this component never inspects any Range
// members beyond what `HitTestTarget` declares (the actual hit-testing
// happens inside `useHighlightHitTest`, mocked away above), so a real `Range`
// is unnecessary here.
const buildRangeFixture = (): HitTestTarget => ({
  getClientRects: () => [] as unknown as DOMRectList,
});

const renderInteraction = (
  overrides: Partial<{
    inlineComments: InlineCommentWithReplies[];
    resolvedRanges: ReadonlyMap<string, ResolvedRange>;
    createReply: (parentId: string, comment: string) => Promise<unknown>;
    resolve: (id: string, resolved: boolean) => Promise<unknown>;
    update: (id: string, comment: string) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    updateReply: (id: string, comment: string) => Promise<unknown>;
    removeReply: (id: string) => Promise<unknown>;
  }> = {},
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const containerRef: RefObject<HTMLElement | null> = { current: container };

  return render(
    <InlineCommentBodyInteraction
      containerRef={containerRef}
      resolvedRanges={overrides.resolvedRanges ?? new Map()}
      inlineComments={overrides.inlineComments ?? [buildComment()]}
      createReply={
        overrides.createReply ?? vi.fn().mockResolvedValue(undefined)
      }
      resolve={overrides.resolve ?? vi.fn().mockResolvedValue(undefined)}
      update={overrides.update ?? vi.fn().mockResolvedValue(undefined)}
      remove={overrides.remove ?? vi.fn().mockResolvedValue(undefined)}
      updateReply={
        overrides.updateReply ?? vi.fn().mockResolvedValue(undefined)
      }
      removeReply={
        overrides.removeReply ?? vi.fn().mockResolvedValue(undefined)
      }
      rendererOptions={rendererOptions}
    />,
  );
};

describe('InlineCommentBodyInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedUseHighlightHitTest.mockReturnValue(null);
    previewPopoverSpy.mockClear();
    mockedRangesById.mockReturnValue(
      new Map<string, HitTestTarget>([
        ['comment1', buildRangeFixture()],
        ['comment2', buildRangeFixture()],
      ]),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders no popover when there is no hit', () => {
    renderInteraction();

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('opens the popover for a hover hit on a desktop-width highlight, after the show delay (Req 15.7)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'hover',
    });

    renderInteraction();

    // Not shown yet -- the hover has not survived the show delay.
    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
    });

    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );
  });

  it('never shows the popover when a hover hit clears before the show delay elapses (Req 15.7)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'hover',
    });
    const { rerender } = renderInteraction();

    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS - 1);
    });
    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();

    // The pointer left the highlight before the show delay finished.
    mockedUseHighlightHitTest.mockReturnValue(null);
    rerender(
      <InlineCommentBodyInteraction
        containerRef={{ current: document.body }}
        resolvedRanges={new Map()}
        inlineComments={[buildComment()]}
        createReply={vi.fn().mockResolvedValue(undefined)}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        rendererOptions={rendererOptions}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS + HOVER_HIDE_DELAY_MS);
    });
    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('updates the shown popover as the hover hit moves to a different highlight', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'hover',
    });
    const { rerender } = renderInteraction({
      inlineComments: [
        buildComment({ id: 'comment1' }),
        buildComment({ id: 'comment2' }),
      ],
    });
    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
    });
    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );

    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment2',
      source: 'hover',
    });
    rerender(
      <InlineCommentBodyInteraction
        containerRef={{ current: document.body }}
        resolvedRanges={new Map()}
        inlineComments={[
          buildComment({ id: 'comment1' }),
          buildComment({ id: 'comment2' }),
        ]}
        createReply={vi.fn().mockResolvedValue(undefined)}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        rendererOptions={rendererOptions}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
    });

    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment2',
    );
  });

  it('keeps the popover shown for the hide grace period after a hover hit clears, then closes it (Req 15.8)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'hover',
    });
    const { rerender } = renderInteraction();
    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
    });
    expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

    mockedUseHighlightHitTest.mockReturnValue(null);
    rerender(
      <InlineCommentBodyInteraction
        containerRef={{ current: document.body }}
        resolvedRanges={new Map()}
        inlineComments={[buildComment()]}
        createReply={vi.fn().mockResolvedValue(undefined)}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        rendererOptions={rendererOptions}
      />,
    );

    // Still shown -- the hide grace period has not elapsed yet.
    act(() => {
      vi.advanceTimersByTime(HOVER_HIDE_DELAY_MS - 1);
    });
    expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('opens the popover for a click hit (tap on tablet-and-below width) (Req 2.2)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction();

    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );
  });

  it('pins a click-opened popover so it survives the hook clearing back to null', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });
    const { rerender } = renderInteraction();
    expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

    // The hook itself does not latch a click id -- once the pointer moves off
    // the highlight, its next pointermove reports null. Pinning must keep the
    // popover open regardless.
    mockedUseHighlightHitTest.mockReturnValue(null);
    rerender(
      <InlineCommentBodyInteraction
        containerRef={{ current: document.body }}
        resolvedRanges={new Map()}
        inlineComments={[buildComment()]}
        createReply={vi.fn().mockResolvedValue(undefined)}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        rendererOptions={rendererOptions}
      />,
    );

    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );
  });

  it('ignores a hover hit elsewhere while a click-pinned popover is open', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });
    const { rerender } = renderInteraction({
      inlineComments: [
        buildComment({ id: 'comment1' }),
        buildComment({ id: 'comment2' }),
      ],
    });
    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );

    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment2',
      source: 'hover',
    });
    rerender(
      <InlineCommentBodyInteraction
        containerRef={{ current: document.body }}
        resolvedRanges={new Map()}
        inlineComments={[
          buildComment({ id: 'comment1' }),
          buildComment({ id: 'comment2' }),
        ]}
        createReply={vi.fn().mockResolvedValue(undefined)}
        resolve={vi.fn().mockResolvedValue(undefined)}
        update={vi.fn().mockResolvedValue(undefined)}
        remove={vi.fn().mockResolvedValue(undefined)}
        updateReply={vi.fn().mockResolvedValue(undefined)}
        removeReply={vi.fn().mockResolvedValue(undefined)}
        rendererOptions={rendererOptions}
      />,
    );

    // Still pinned to comment1 -- the hover elsewhere on comment2 is ignored.
    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );
  });

  it("closes the popover via the popover's own close mechanism (Req 2.4)", () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });
    renderInteraction();
    expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('offers no popover when the hit comment id cannot be found in the inline comments list (Req 2.6 defensive guard)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'missing-comment',
      source: 'click',
    });

    renderInteraction({ inlineComments: [buildComment({ id: 'comment1' })] });

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('offers no popover when the hit id has no resolvable Range (Req 2.6)', () => {
    mockedRangesById.mockReturnValue(new Map());
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction();

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('forwards createReply and rendererOptions through to the popover', () => {
    const createReply = vi.fn().mockResolvedValue(undefined);
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction({ createReply });

    expect(previewPopoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ createReply, rendererOptions }),
    );
  });

  // Requirement 2.6: the popover deletes the origin comment and edits/deletes
  // replies, so the operations it needs have to reach it from here.
  it('forwards the origin-delete and reply edit/delete operations through to the popover (Req 2.6)', () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const updateReply = vi.fn().mockResolvedValue(undefined);
    const removeReply = vi.fn().mockResolvedValue(undefined);
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction({ remove, updateReply, removeReply });

    expect(previewPopoverSpy).toHaveBeenCalledWith(
      expect.objectContaining({ remove, updateReply, removeReply }),
    );
  });

  it('threads the resolve prop through to the popover so it can be invoked from there', () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction({ resolve });

    fireEvent.click(screen.getByRole('button', { name: 'resolve' }));

    expect(resolve).toHaveBeenCalledWith('comment1', true);
  });

  describe('pointer entering the popover (Req 15.9)', () => {
    it('reaching the popover before the hide grace period elapses keeps it open indefinitely, with no further hover hit at all', () => {
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment1',
        source: 'hover',
      });
      const { rerender } = renderInteraction();
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
      });
      expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

      // Pointer leaves the highlight, travelling toward the popover.
      mockedUseHighlightHitTest.mockReturnValue(null);
      rerender(
        <InlineCommentBodyInteraction
          containerRef={{ current: document.body }}
          resolvedRanges={new Map()}
          inlineComments={[buildComment()]}
          createReply={vi.fn().mockResolvedValue(undefined)}
          resolve={vi.fn().mockResolvedValue(undefined)}
          update={vi.fn().mockResolvedValue(undefined)}
          remove={vi.fn().mockResolvedValue(undefined)}
          updateReply={vi.fn().mockResolvedValue(undefined)}
          removeReply={vi.fn().mockResolvedValue(undefined)}
          rendererOptions={rendererOptions}
        />,
      );

      // Reaches the popover before the hide grace period elapses.
      act(() => {
        vi.advanceTimersByTime(HOVER_HIDE_DELAY_MS - 1);
      });
      fireEvent.click(screen.getByRole('button', { name: 'enter popover' }));

      // Advancing well past both delays with no further hover hit at all --
      // the popover behaves exactly like a click-pinned one from here on.
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS + HOVER_HIDE_DELAY_MS * 5);
      });
      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment1');
    });

    it('closing after the pointer entered the popover goes through the ordinary close mechanism (Req 15.4)', () => {
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment1',
        source: 'hover',
      });
      renderInteraction();
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
      });

      fireEvent.click(screen.getByRole('button', { name: 'enter popover' }));
      expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'close' }));

      expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
    });

    it('is a no-op when a popover is already pinned by a click', () => {
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment1',
        source: 'click',
      });
      renderInteraction();
      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment1');

      // Calling the pointer-enter promotion while already pinned must not
      // throw or change what is displayed.
      fireEvent.click(screen.getByRole('button', { name: 'enter popover' }));

      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment1');
    });
  });

  describe('the displayed id disappearing from inlineComments (Req 15.12)', () => {
    it('clears pinnedId (not just the render) when the pinned comment is resolved and filtered out', () => {
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment1',
        source: 'click',
      });
      const { rerender } = renderInteraction({
        inlineComments: [
          buildComment({ id: 'comment1' }),
          buildComment({ id: 'comment2' }),
        ],
      });
      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment1');

      // comment1 no longer appears in inlineComments -- this is what the
      // REAL production shape looks like once it is resolved: PageView.tsx's
      // `bodyInlineComments` filters a resolved comment out of the array
      // BEFORE it ever reaches this component's `inlineComments` prop (it is
      // never passed here with `resolvedAt` merely set while remaining in the
      // array). The pointer also moved off the highlight.
      mockedUseHighlightHitTest.mockReturnValue(null);
      rerender(
        <InlineCommentBodyInteraction
          containerRef={{ current: document.body }}
          resolvedRanges={new Map()}
          inlineComments={[buildComment({ id: 'comment2' })]}
          createReply={vi.fn().mockResolvedValue(undefined)}
          resolve={vi.fn().mockResolvedValue(undefined)}
          update={vi.fn().mockResolvedValue(undefined)}
          remove={vi.fn().mockResolvedValue(undefined)}
          updateReply={vi.fn().mockResolvedValue(undefined)}
          removeReply={vi.fn().mockResolvedValue(undefined)}
          rendererOptions={rendererOptions}
        />,
      );
      expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();

      // If pinnedId were merely masked by the render guard rather than
      // actually cleared, it would still be non-null here, and the hover
      // effect's `if (pinnedId != null) return undefined;` early-return
      // would keep ignoring every hover hit forever -- comment2 could never
      // be shown by hovering. Showing it here proves pinnedId was reset to
      // null, not just rendered around.
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment2',
        source: 'hover',
      });
      rerender(
        <InlineCommentBodyInteraction
          containerRef={{ current: document.body }}
          resolvedRanges={new Map()}
          inlineComments={[buildComment({ id: 'comment2' })]}
          createReply={vi.fn().mockResolvedValue(undefined)}
          resolve={vi.fn().mockResolvedValue(undefined)}
          update={vi.fn().mockResolvedValue(undefined)}
          remove={vi.fn().mockResolvedValue(undefined)}
          updateReply={vi.fn().mockResolvedValue(undefined)}
          removeReply={vi.fn().mockResolvedValue(undefined)}
          rendererOptions={rendererOptions}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
      });

      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment2');
    });

    it('clears hoverPreviewId (not just the render) when the hover-shown comment is deleted', () => {
      mockedUseHighlightHitTest.mockReturnValue({
        commentId: 'comment1',
        source: 'hover',
      });
      const { rerender } = renderInteraction({
        inlineComments: [buildComment({ id: 'comment1' })],
      });
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
      });
      expect(screen.getByTestId('preview-popover')).toBeInTheDocument();

      // comment1 is deleted -- it no longer appears in inlineComments. The
      // hook keeps reporting the same hover hit (deletion does not, by
      // itself, change what the pointer is currently over).
      rerender(
        <InlineCommentBodyInteraction
          containerRef={{ current: document.body }}
          resolvedRanges={new Map()}
          inlineComments={[]}
          createReply={vi.fn().mockResolvedValue(undefined)}
          resolve={vi.fn().mockResolvedValue(undefined)}
          update={vi.fn().mockResolvedValue(undefined)}
          remove={vi.fn().mockResolvedValue(undefined)}
          updateReply={vi.fn().mockResolvedValue(undefined)}
          removeReply={vi.fn().mockResolvedValue(undefined)}
          rendererOptions={rendererOptions}
        />,
      );
      expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();

      // comment1 reappears in inlineComments (e.g. a subsequent refetch). If
      // hoverPreviewId had never actually been reset to null, the hover
      // effect's `if (hoverPreviewId !== effectiveHit.commentId)` guard would
      // see them as already equal and skip arming a new show timer, so the
      // popover would reappear immediately with no delay. Requiring the
      // delay to elapse again proves hoverPreviewId was actually cleared.
      rerender(
        <InlineCommentBodyInteraction
          containerRef={{ current: document.body }}
          resolvedRanges={new Map()}
          inlineComments={[buildComment({ id: 'comment1' })]}
          createReply={vi.fn().mockResolvedValue(undefined)}
          resolve={vi.fn().mockResolvedValue(undefined)}
          update={vi.fn().mockResolvedValue(undefined)}
          remove={vi.fn().mockResolvedValue(undefined)}
          updateReply={vi.fn().mockResolvedValue(undefined)}
          removeReply={vi.fn().mockResolvedValue(undefined)}
          rendererOptions={rendererOptions}
        />,
      );
      expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS);
      });
      expect(
        screen.getByTestId('preview-popover-comment-id'),
      ).toHaveTextContent('comment1');
    });
  });

  it('clears pending timers on unmount (no state update after unmount)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'hover',
    });
    const { unmount } = renderInteraction();

    unmount();

    // If the pending show-timer were not cleared, it would fire here and
    // attempt a setState on the unmounted component -- React would log a
    // warning/throw in dev. Simply advancing past both delays without error
    // is the assertion.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS + HOVER_HIDE_DELAY_MS);
      });
    }).not.toThrow();
  });

  it('the click path still shows the popover immediately with no delay (Req 15.1 regression)', () => {
    mockedUseHighlightHitTest.mockReturnValue({
      commentId: 'comment1',
      source: 'click',
    });

    renderInteraction();

    // No timer advance at all -- click must never be debounced.
    expect(screen.getByTestId('preview-popover-comment-id')).toHaveTextContent(
      'comment1',
    );
  });
});
