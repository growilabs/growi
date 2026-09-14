/**
 * Wiring test for task 6.3 (inline-comment-visual-consistency, amending
 * inline-comment's task 5.2): PageView.tsx connects the container ref
 * RevisionRenderer.tsx forwards (task 5.1) to
 * SelectionCapture/InlineCommentForm (4.2), the AnchorResolver hook +
 * InlineCommentHighlight (4.3), alongside the existing page-footer
 * `Comments` component, which now receives the fetched inline comments
 * bundled with `resolve`/`createReply` as its `inlineComments` prop
 * (design.md 決定3 / tasks.md 6.1's Implementation Notes) instead of a
 * separately-rendered `InlineCommentList`.
 *
 * This test does not re-verify any of those components' own internal
 * behavior (already covered by their own specs) — it only verifies that
 * PageView.tsx wires them together correctly:
 *   - normal page view: SelectionCapture/InlineCommentHighlight mount,
 *     sharing one container ref with `useAnchorResolver`, and `Comments`
 *     receives `inlineComments={{ comments, resolve, createReply }}` built
 *     from `useSWRxInlineComments(pageId)`'s own return value.
 *   - share-link view (`useShareLinkId()` non-null): none of the
 *     inline-comment UI mounts, `useSWRxInlineComments` is called with
 *     `null` (no inline-comment network request at all) — the client-side
 *     defense-in-depth half of Requirement 6.2 — and `Comments` receives no
 *     `inlineComments` prop at all. Note PageView.tsx is, today, only ever
 *     rendered by the normal page route (`pages/[[...path]]/index.page.tsx`);
 *     the share-link route renders the separate `ShareLinkPageView`
 *     component instead, which never imports any inline-comment piece. So
 *     this scenario is a guard against a *future* reuse of PageView.tsx
 *     under a share-link context, not a currently-reachable one — see
 *     PageView.tsx's own comment at the `useShareLinkId()` call site for the
 *     full reasoning, and CONCERNS in the task report.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  InlineCommentAnchor,
  InlineCommentWithReplies,
  ResolvedRange,
} from '~/features/inline-comment/interfaces';
import type { RendererConfig } from '~/interfaces/services/renderer';

// ---- Layout / chrome: rendered for real by PageView.tsx (not next/dynamic),
// stubbed here since this test only cares about the body content wiring. ----
vi.mock('./PageViewLayout', () => ({
  PageViewLayout: ({ children }: { children?: ReactNode }) => (
    <div data-testid="page-view-layout">{children}</div>
  ),
}));
vi.mock('./PageAlerts/PageAlerts', () => ({ PageAlerts: () => null }));
vi.mock('./PageContentFooter', () => ({ PageContentFooter: () => null }));
vi.mock('./use-hash-auto-scroll', () => ({ useHashAutoScroll: vi.fn() }));
vi.mock('../User/UserInfo', () => ({ UserInfo: () => null }));
vi.mock('~/components/Common/PagePathNavTitle', () => ({
  PagePathNavTitle: () => null,
}));

// ---- next/dynamic targets unrelated to this task: stubbed to trivial,
// synchronously-resolvable modules so the dynamic loader settles fast. ----
vi.mock('~/client/components/NotCreatablePage', () => ({
  NotCreatablePage: () => null,
}));
vi.mock('~/client/components/ForbiddenPage', () => ({ default: () => null }));
vi.mock('~/client/components/NotFoundPage', () => ({ default: () => null }));
vi.mock('~/client/components/PageSideContents', () => ({
  PageSideContents: () => null,
}));
vi.mock('~/client/components/Page/PageContentsUtilities', () => ({
  PageContentsUtilities: () => null,
}));
vi.mock('~/client/components/UsersHomepageFooter', () => ({
  UsersHomepageFooter: () => null,
}));
vi.mock('~/client/components/IdenticalPathPage', () => ({
  IdenticalPathPage: () => null,
}));
vi.mock('~/client/components/Page/SlideRenderer', () => ({
  SlideRenderer: () => null,
}));
// Renders real text (not an empty div) so `rangesById()` — which rebuilds a
// `Range` from the container's live DOM text — has something to resolve the
// scrollToRange tests' offsets against.
const PAGE_BODY_TEXT = 'The quick brown fox jumps over the lazy dog.';
vi.mock('./PageContentRenderer', () => ({
  PageContentRenderer: () => (
    <div data-testid="page-content-renderer">
      The quick brown fox jumps over the lazy dog.
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/client/util/toastr', () => ({ toastError: vi.fn() }));

// ---- Comments: the EXISTING page-footer comment thread. It now receives
// the fetched inline comments bundled with resolve/createReply as its
// `inlineComments` prop (task 6.3) instead of InlineCommentList being
// rendered as a sibling. ----
type CommentsProps = {
  pageId: string;
  inlineComments?: {
    comments: InlineCommentWithReplies[];
    resolve: (id: string, resolved: boolean) => Promise<unknown>;
    createReply: (parentId: string, comment: string) => Promise<unknown>;
    // task 4.1 (inline-comment-interaction-ux): Comments' own declared prop
    // type does not carry this yet (task 4.2 widens that boundary) -- declared
    // here so this test can read the callback PageView.tsx now bundles.
    scrollToRange?: (commentId: string) => boolean;
  };
};
const commentsSpy = vi.fn<(props: CommentsProps) => void>();
vi.mock('~/client/components/Comments', () => ({
  Comments: (props: CommentsProps) => {
    commentsSpy(props);
    return <div data-testid="comments" />;
  },
}));

// ---- The three inline-comment UI pieces this task wires in. ----
type SelectionCaptureProps = {
  containerRef: { current: HTMLElement | null };
  pageId: string;
  anchorOriginRevisionId: string;
};
const selectionCaptureSpy = vi.fn<(props: SelectionCaptureProps) => void>();
// SelectionCapture owns the in-progress inline-comment state (its locked
// anchor and the open form), so its mount/unmount count — not just its
// presence — is the observable that the subtree-stability test below asserts
// on: a remount silently discards a comment the user is in the middle of
// writing.
const selectionCaptureMountSpy = vi.fn();
const selectionCaptureUnmountSpy = vi.fn();
vi.mock(
  '~/features/inline-comment/client/components/SelectionCapture/SelectionCapture',
  () => ({
    SelectionCapture: (props: SelectionCaptureProps) => {
      selectionCaptureSpy(props);
      useEffect(() => {
        selectionCaptureMountSpy();
        return () => selectionCaptureUnmountSpy();
      }, []);
      return <div data-testid="selection-capture" />;
    },
  }),
);

type InlineCommentHighlightProps = {
  containerRef: { current: HTMLElement | null };
  resolvedRanges: ReadonlyMap<string, ResolvedRange>;
};
const inlineCommentHighlightSpy =
  vi.fn<(props: InlineCommentHighlightProps) => void>();
vi.mock(
  '~/features/inline-comment/client/components/InlineCommentHighlight/InlineCommentHighlight',
  () => ({
    InlineCommentHighlight: (props: InlineCommentHighlightProps) => {
      inlineCommentHighlightSpy(props);
      return <div data-testid="inline-comment-highlight" />;
    },
  }),
);

// ---- task 3.3 (inline-comment-interaction-ux): the hover/click/tap preview
// popover wiring. Its own open/close policy is covered by its own spec; this
// file only needs to confirm PageView.tsx wires the same containerRef/
// resolvedRanges/inlineComments/createReply through to it. ----
type InlineCommentBodyInteractionProps = {
  containerRef: { current: HTMLElement | null };
  resolvedRanges: ReadonlyMap<string, ResolvedRange>;
  inlineComments: InlineCommentWithReplies[];
  createReply: (parentId: string, comment: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  updateReply: (id: string, comment: string) => Promise<unknown>;
  removeReply: (id: string) => Promise<unknown>;
};
const inlineCommentBodyInteractionSpy =
  vi.fn<(props: InlineCommentBodyInteractionProps) => void>();
vi.mock(
  '~/features/inline-comment/client/components/InlineCommentBodyInteraction/InlineCommentBodyInteraction',
  () => ({
    InlineCommentBodyInteraction: (
      props: InlineCommentBodyInteractionProps,
    ) => {
      inlineCommentBodyInteractionSpy(props);
      return <div data-testid="inline-comment-body-interaction" />;
    },
  }),
);

vi.mock(
  '~/features/inline-comment/client/components/AnchorResolver/use-anchor-resolver',
  () => ({ useAnchorResolver: vi.fn() }),
);
vi.mock('~/features/inline-comment/client/stores/inline-comment', () => ({
  useSWRxInlineComments: vi.fn(),
}));

// ---- Page state / renderer stores. ----
vi.mock('~/states/page', () => ({
  useCurrentPageData: vi.fn(),
  useCurrentPageId: vi.fn(() => 'page-1'),
  useIsForbidden: vi.fn(() => false),
  useIsIdenticalPath: vi.fn(() => false),
  useIsNotCreatable: vi.fn(() => false),
  usePageNotFound: vi.fn(() => false),
  useShareLinkId: vi.fn(() => undefined),
}));
vi.mock('~/stores/renderer', () => ({
  useViewOptions: vi.fn(() => ({ data: undefined })),
  useCommentForCurrentPageOptions: vi.fn(() => ({ data: undefined })),
}));
vi.mock('~/services/layout/use-should-expand-content', () => ({
  useShouldExpandContent: vi.fn(() => false),
}));
vi.mock('@growi/presentation/dist/services', () => ({
  useSlidesByFrontmatter: vi.fn(() => null),
}));

// biome-ignore lint/style/noRestrictedImports: importing the vi.mock'd module above to get a typed handle on its mock
import { toastError } from '~/client/util/toastr';
// biome-ignore lint/style/noRestrictedImports: importing the vi.mock'd module above to get a typed handle on its mock
import { useAnchorResolver } from '~/features/inline-comment/client/components/AnchorResolver/use-anchor-resolver';
// biome-ignore lint/style/noRestrictedImports: importing the vi.mock'd module above to get a typed handle on its mock
import { useSWRxInlineComments } from '~/features/inline-comment/client/stores/inline-comment';
import {
  useCurrentPageData,
  useCurrentPageId,
  useIsForbidden,
  useIsIdenticalPath,
  useIsNotCreatable,
  usePageNotFound,
  useShareLinkId,
} from '~/states/page';

import { PageView } from './PageView';

const mockedUseAnchorResolver = vi.mocked(useAnchorResolver);
const mockedUseSWRxInlineComments = vi.mocked(useSWRxInlineComments);
const mockedUseCurrentPageData = vi.mocked(useCurrentPageData);
const mockedUseShareLinkId = vi.mocked(useShareLinkId);

const PAGE_ID = 'page-1';
const REVISION_ID = 'revision-1';

const buildAnchor = (
  overrides: Partial<InlineCommentAnchor> = {},
): InlineCommentAnchor => ({
  quote: 'quoted text',
  prefix: 'before ',
  suffix: ' after',
  approxOffset: 10,
  ...overrides,
});

const buildInlineComment = (
  overrides: Partial<InlineCommentWithReplies> = {},
): InlineCommentWithReplies => ({
  id: 'inline-comment-1',
  pageId: PAGE_ID,
  creatorId: 'user-1',
  creator: null,
  comment: 'a comment',
  anchorOriginRevisionId: REVISION_ID,
  anchor: buildAnchor(),
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  replies: [],
  ...overrides,
});

// biome-ignore lint/suspicious/noExplicitAny: minimal literal page fixture, cast per this codebase's own SearchResultContent.spec.tsx precedent (a hand-built full IPagePopulatedToShowRevision would be dozens of unrelated fields)
const buildPage = (overrides: Record<string, unknown> = {}): any => ({
  _id: PAGE_ID,
  path: '/test-page',
  wip: false,
  creator: null,
  revision: { _id: REVISION_ID, body: '# hello' },
  ...overrides,
});

const rendererConfig = {} as RendererConfig;

describe('PageView', () => {
  beforeEach(() => {
    // vi.clearAllMocks() only clears call history, not the return values set
    // by the vi.fn(() => ...) factories in the vi.mock() calls above — so
    // every hook this test depends on for gating (isIdenticalPathPage,
    // isNotFound, isForbidden, isNotCreatable, currentPageId, shareLinkId)
    // is explicitly re-armed here rather than relying on the factory default
    // surviving a clear.
    vi.clearAllMocks();
    vi.mocked(useCurrentPageId).mockReturnValue('page-1');
    vi.mocked(useIsForbidden).mockReturnValue(false);
    vi.mocked(useIsIdenticalPath).mockReturnValue(false);
    vi.mocked(useIsNotCreatable).mockReturnValue(false);
    vi.mocked(usePageNotFound).mockReturnValue(false);
    mockedUseAnchorResolver.mockReturnValue(new Map<string, ResolvedRange>());
    mockedUseSWRxInlineComments.mockReturnValue({
      data: [],
      resolve: vi.fn(),
      createReply: vi.fn(),
    } as unknown as ReturnType<typeof useSWRxInlineComments>);
    mockedUseShareLinkId.mockReturnValue(undefined);
  });

  describe('normal page view (no share link)', () => {
    it('mounts SelectionCapture and InlineCommentHighlight, and passes the fetched inline comments bundled with resolve/createReply to the existing Comments, sharing one container ref with useAnchorResolver', async () => {
      const inlineComments = [buildInlineComment()];
      const resolveMock = vi.fn();
      const createReplyMock = vi.fn();
      const removeMock = vi.fn();
      const updateReplyMock = vi.fn();
      const removeReplyMock = vi.fn();
      mockedUseSWRxInlineComments.mockReturnValue({
        data: inlineComments,
        resolve: resolveMock,
        createReply: createReplyMock,
        remove: removeMock,
        updateReply: updateReplyMock,
        removeReply: removeReplyMock,
      } as unknown as ReturnType<typeof useSWRxInlineComments>);
      mockedUseCurrentPageData.mockReturnValue(buildPage());

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );

      await screen.findByTestId('selection-capture');
      await screen.findByTestId('inline-comment-highlight');
      await screen.findByTestId('inline-comment-body-interaction');
      await screen.findByTestId('comments');

      expect(selectionCaptureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: PAGE_ID,
          anchorOriginRevisionId: REVISION_ID,
        }),
      );
      expect(inlineCommentBodyInteractionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          inlineComments,
        }),
      );
      expect(
        inlineCommentBodyInteractionSpy.mock.calls[0]?.[0]?.resolvedRanges,
      ).toBe(inlineCommentHighlightSpy.mock.calls[0]?.[0]?.resolvedRanges);
      // Same container ref reaches InlineCommentBodyInteraction too -- one
      // DOM subtree, not an independently-scoped one.
      expect(
        inlineCommentBodyInteractionSpy.mock.calls[0]?.[0]?.containerRef,
      ).toBe(selectionCaptureSpy.mock.calls[0]?.[0]?.containerRef);

      // Requirement 2.6: the popover deletes the origin comment and
      // edits/deletes replies, so those store operations have to reach
      // InlineCommentBodyInteraction too -- the same ones the bottom-of-page
      // list item already receives, not new ones.
      expect(inlineCommentBodyInteractionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          remove: removeMock,
          updateReply: updateReplyMock,
          removeReply: removeReplyMock,
        }),
      );

      // createReply is adapted the same way as inlineCommentsForComments'
      // own createReply (parentId, { comment }) shape (task 3.3).
      const bodyInteractionCreateReply =
        inlineCommentBodyInteractionSpy.mock.calls[0]?.[0]?.createReply;
      await bodyInteractionCreateReply?.('parent-1', 'a reply');
      expect(createReplyMock).toHaveBeenCalledWith('parent-1', {
        comment: 'a reply',
      });
      expect(commentsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: PAGE_ID,
          inlineComments: expect.objectContaining({
            comments: inlineComments,
            resolve: resolveMock,
            createReply: expect.any(Function),
          }),
        }),
      );

      // createReply is adapted from the store's (parentId, { comment })
      // request-body shape to Comments'/PageComment's (parentId, comment)
      // shape (task 6.1's Implementation Notes) -- verify the delegation.
      const passedInlineComments =
        commentsSpy.mock.calls[0]?.[0]?.inlineComments;
      await passedInlineComments?.createReply('parent-1', 'a reply');
      expect(createReplyMock).toHaveBeenCalledWith('parent-1', {
        comment: 'a reply',
      });

      // The same container ref must reach SelectionCapture, InlineCommentHighlight,
      // AND useAnchorResolver — three components reading/writing one DOM subtree,
      // not three independently-scoped ones.
      const captureRef = selectionCaptureSpy.mock.calls[0]?.[0]?.containerRef;
      const highlightRef =
        inlineCommentHighlightSpy.mock.calls[0]?.[0]?.containerRef;
      expect(captureRef).toBeDefined();
      expect(highlightRef).toBe(captureRef);
      expect(mockedUseAnchorResolver).toHaveBeenCalledWith(captureRef, [
        { id: inlineComments[0]?.id, anchor: inlineComments[0]?.anchor },
      ]);
    });

    it('computes anchors for ALL comments (resolved included), but excludes a resolved comment from the resolved-ranges and inlineComments props handed to the highlight/popover consumers, while an unresolved comment in the same list is included in both (Requirement 2, AC 2.7)', async () => {
      // Two comments, not one -- with only one comment in the fixture, an
      // exclusion bug could not be told apart from "the list is simply
      // empty/wrong for an unrelated reason". A resolved comment alongside a
      // still-unresolved one is the only way to prove the filter actually
      // discriminates between them.
      const unresolvedComment = buildInlineComment({
        id: 'inline-comment-unresolved',
      });
      const resolvedComment = buildInlineComment({
        id: 'inline-comment-resolved',
        resolvedAt: new Date('2026-01-02T00:00:00Z'),
        resolvedById: 'user-2',
      });
      mockedUseSWRxInlineComments.mockReturnValue({
        data: [unresolvedComment, resolvedComment],
        resolve: vi.fn(),
        createReply: vi.fn(),
      } as unknown as ReturnType<typeof useSWRxInlineComments>);
      mockedUseCurrentPageData.mockReturnValue(buildPage());
      mockedUseAnchorResolver.mockReturnValue(
        new Map([
          [
            unresolvedComment.id,
            { status: 'exact', startOffset: 0, endOffset: 1 },
          ],
          [
            resolvedComment.id,
            { status: 'exact', startOffset: 2, endOffset: 3 },
          ],
        ]),
      );

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );

      await screen.findByTestId('inline-comment-body-interaction');

      // useAnchorResolver must be asked to resolve BOTH comments' anchors --
      // resolving a comment must not stop the page from being able to locate
      // it (Requirement 16: clicking it in the footer list must still scroll
      // to its position). Excluding it here regressed that: `scrollToRange`
      // could no longer find the comment's Range at all, so clicking a
      // resolved item in the list showed a "could not be found... may have
      // been edited or removed" error, which is wrong -- the text is still
      // there, it's simply resolved.
      expect(mockedUseAnchorResolver).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          { id: unresolvedComment.id, anchor: unresolvedComment.anchor },
          { id: resolvedComment.id, anchor: resolvedComment.anchor },
        ]),
      );

      // The resolved-ranges prop reaching the highlight/popover consumers
      // must exclude the resolved comment's range, even though
      // useAnchorResolver resolved it -- this is what actually keeps it from
      // being passively highlighted or offered a popover.
      expect(inlineCommentBodyInteractionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resolvedRanges: new Map([
            [
              unresolvedComment.id,
              { status: 'exact', startOffset: 0, endOffset: 1 },
            ],
          ]),
        }),
      );

      // The SAME filtered comment list must reach InlineCommentBodyInteraction's
      // `inlineComments` prop -- this is the exact invariant that regressed
      // when PageView.tsx fed InlineCommentBodyInteraction the raw,
      // unfiltered list while only the resolved-ranges view was filtered: a
      // resolved comment's popover state could then never be cleared,
      // permanently blocking every other highlight's hover popover.
      expect(inlineCommentBodyInteractionSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          inlineComments: [unresolvedComment],
        }),
      );
    });
  });

  describe('page-body subtree stability', () => {
    it('keeps SelectionCapture mounted when useAnchorResolver hands back a new Map identity (as it does on every settle)', async () => {
      mockedUseCurrentPageData.mockReturnValue(buildPage());

      // Mirrors the real hook: resolveAll() always builds a BRAND NEW Map and
      // setResolved() replaces the previous one, so this hook's return value
      // takes a new identity on every settle event and on every
      // anchors-content change — i.e. repeatedly during ordinary viewing.
      let emitNewMap: (() => void) | undefined;
      mockedUseAnchorResolver.mockImplementation(() => {
        const [resolved, setResolved] = useState<
          ReadonlyMap<string, ResolvedRange>
        >(() => new Map());
        emitNewMap = () => setResolved(new Map());
        return resolved;
      });

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );

      await screen.findByTestId('selection-capture');
      await waitFor(() => {
        expect(selectionCaptureMountSpy).toHaveBeenCalledTimes(1);
      });

      act(() => {
        emitNewMap?.();
      });

      // The page body must be reconciled in place. Rendering it as a
      // component whose identity changes with its dependencies (the old
      // `const Contents = useCallback(...)` / `<Contents />` shape) made React
      // treat it as a different element type and remount the whole subtree,
      // throwing away SelectionCapture's in-progress inline comment.
      expect(selectionCaptureUnmountSpy).not.toHaveBeenCalled();
      expect(selectionCaptureMountSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('selection-capture')).toBeInTheDocument();
    });
  });

  /**
   * task 4.1 (inline-comment-interaction-ux), Requirements 3.1/3.2/3.3:
   * `scrollToRange(commentId)` is bundled into the same `inlineComments`
   * object `Comments` already receives, so the comment list can navigate to
   * the highlighted range in the page body. Read off the spy rather than
   * through a new export — the bundle IS the contract (design.md 決定4).
   *
   * happy-dom implements neither the CSS Custom Highlight API
   * (`CSS.highlights` / the global `Highlight` constructor) nor real layout,
   * so the observables here are "did PageView ask the browser to scroll" and
   * "did it register/unregister the emphasis highlight over the right text" —
   * the same approach InlineCommentHighlight.spec.tsx takes.
   */
  describe('scrollToRange (comment list -> page body navigation)', () => {
    class FakeHighlight {
      readonly ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    const EMPHASIS_NAME = 'growi-inline-comment-emphasis';

    let highlightRegistry: Map<string, FakeHighlight>;
    let scrollIntoViewSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      highlightRegistry = new Map();
      vi.stubGlobal('Highlight', FakeHighlight);
      vi.stubGlobal('CSS', {
        ...globalThis.CSS,
        highlights: highlightRegistry,
      });
      scrollIntoViewSpy = vi
        .spyOn(Element.prototype, 'scrollIntoView')
        .mockImplementation(() => {});
    });

    afterEach(() => {
      // Unmount (running PageView's own emphasis cleanup, which touches
      // CSS.highlights) BEFORE the stub is removed -- RTL's auto-cleanup
      // afterEach is registered at file scope and would otherwise run later.
      cleanup();
      scrollIntoViewSpy.mockRestore();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    const renderAndGetScrollToRange = async (
      resolvedRanges: ReadonlyMap<string, ResolvedRange>,
    ) => {
      mockedUseCurrentPageData.mockReturnValue(buildPage());
      mockedUseSWRxInlineComments.mockReturnValue({
        data: [buildInlineComment()],
        resolve: vi.fn(),
        createReply: vi.fn(),
      } as unknown as ReturnType<typeof useSWRxInlineComments>);
      mockedUseAnchorResolver.mockReturnValue(resolvedRanges);

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );
      await screen.findByTestId('comments');
      // PAGE_BODY_TEXT is necessarily duplicated as a literal inside the
      // hoisted vi.mock factory above; this makes a drift between the two
      // fail loudly here instead of silently shifting the offsets below.
      expect(screen.getByTestId('page-content-renderer').textContent).toBe(
        PAGE_BODY_TEXT,
      );

      const scrollToRange =
        commentsSpy.mock.calls.at(-1)?.[0]?.inlineComments?.scrollToRange;
      expect(scrollToRange).toBeTypeOf('function');
      // biome-ignore lint/style/noNonNullAssertion: asserted to be a function directly above
      return scrollToRange!;
    };

    const QUOTE = 'quick brown fox';
    const resolvedExact = (): ReadonlyMap<string, ResolvedRange> =>
      new Map<string, ResolvedRange>([
        [
          'inline-comment-1',
          {
            status: 'exact',
            startOffset: PAGE_BODY_TEXT.indexOf(QUOTE),
            endOffset: PAGE_BODY_TEXT.indexOf(QUOTE) + QUOTE.length,
          },
        ],
      ]);

    it('scrolls to the range, emphasises it temporarily, removes the emphasis after the delay, and returns true', async () => {
      const scrollToRange = await renderAndGetScrollToRange(resolvedExact());

      // Fake timers are installed only AFTER the dynamic-import mount has
      // settled -- installing them before render() starves next/dynamic's own
      // timer-driven resolution and the mount never completes.
      vi.useFakeTimers();

      expect(scrollToRange('inline-comment-1')).toBe(true);

      expect(scrollIntoViewSpy).toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();

      const emphasised = highlightRegistry.get(EMPHASIS_NAME);
      expect(emphasised?.ranges).toHaveLength(1);
      expect(emphasised?.ranges[0]?.toString()).toBe(QUOTE);

      // Still emphasised just before the removal is due...
      vi.advanceTimersByTime(1999);
      expect(highlightRegistry.has(EMPHASIS_NAME)).toBe(true);
      // ...and gone once it is.
      vi.advanceTimersByTime(1);
      expect(highlightRegistry.has(EMPHASIS_NAME)).toBe(false);
    });

    it("still scrolls to a RESOLVED comment's range and returns true (Requirement 16 must keep working after resolving -- only the passive highlight/popover are suppressed, not list-click navigation)", async () => {
      mockedUseCurrentPageData.mockReturnValue(buildPage());
      mockedUseSWRxInlineComments.mockReturnValue({
        data: [
          buildInlineComment({
            resolvedAt: new Date('2026-01-02T00:00:00Z'),
            resolvedById: 'user-2',
          }),
        ],
        resolve: vi.fn(),
        createReply: vi.fn(),
      } as unknown as ReturnType<typeof useSWRxInlineComments>);
      mockedUseAnchorResolver.mockReturnValue(resolvedExact());

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );
      await screen.findByTestId('comments');

      const scrollToRange =
        commentsSpy.mock.calls.at(-1)?.[0]?.inlineComments?.scrollToRange;
      expect(scrollToRange).toBeTypeOf('function');

      // biome-ignore lint/style/noNonNullAssertion: asserted to be a function directly above
      expect(scrollToRange!('inline-comment-1')).toBe(true);
      expect(scrollIntoViewSpy).toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    });

    it('returns false, does not scroll, and notifies the user when the anchor failed to re-anchor', async () => {
      const scrollToRange = await renderAndGetScrollToRange(
        new Map<string, ResolvedRange>([
          ['inline-comment-1', { status: 'not_found' }],
        ]),
      );

      expect(scrollToRange('inline-comment-1')).toBe(false);

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
      expect(highlightRegistry.has(EMPHASIS_NAME)).toBe(false);
      expect(toastError).toHaveBeenCalledWith('inline_comment.range_not_found');
    });

    it('returns false without throwing when the page-body container ref is empty', async () => {
      const scrollToRange = await renderAndGetScrollToRange(resolvedExact());

      // Unmounting detaches the page-body container, leaving the ref null --
      // the only way this component's own ref is ever empty at call time.
      cleanup();

      expect(scrollToRange('inline-comment-1')).toBe(false);
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
      // Same single failure path as a failed re-anchor: there is no highlight
      // in the body to scroll to, which is the condition AC 3.2 describes.
      expect(toastError).toHaveBeenCalledWith('inline_comment.range_not_found');
    });
  });

  describe('share-link view (useShareLinkId() reports a share link)', () => {
    it('mounts none of the inline-comment UI, makes no inline-comment request, and passes no inlineComments prop to Comments', () => {
      mockedUseShareLinkId.mockReturnValue('a-share-link-id');
      mockedUseCurrentPageData.mockReturnValue(buildPage());

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );

      expect(screen.queryByTestId('selection-capture')).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-highlight'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('inline-comment-body-interaction'),
      ).not.toBeInTheDocument();

      // Requirement 6.2's client-side defense-in-depth half: no inline-comment
      // list request is even made when this component is viewed via a share link.
      expect(mockedUseSWRxInlineComments).toHaveBeenCalledWith(null);
      // ...and never with the actual page id, on any render.
      expect(mockedUseSWRxInlineComments).not.toHaveBeenCalledWith(PAGE_ID);

      // Requirement 13.8: no inlineComments prop reaches Comments at all in
      // the share-link view (not even an empty bundle), since Comments is
      // also reachable from ShareLinkPageView and must never render
      // inline-comment content for an unauthenticated share-link viewer.
      expect(screen.queryByTestId('comments')).not.toBeInTheDocument();
    });
  });
});
