/**
 * Wiring test for task 5.2 (inline-comment): PageView.tsx connects the
 * container ref RevisionRenderer.tsx forwards (task 5.1) to
 * SelectionCapture/InlineCommentForm (4.2), the AnchorResolver hook +
 * InlineCommentHighlight (4.3), and InlineCommentList (4.4), alongside the
 * existing page-footer `Comments` component.
 *
 * This test does not re-verify any of those components' own internal
 * behavior (already covered by their own specs) — it only verifies that
 * PageView.tsx wires them together correctly:
 *   - normal page view: all three UI pieces mount, sharing one container
 *     ref with `useAnchorResolver`, and the anchors passed to
 *     `useAnchorResolver` come from `useSWRxInlineComments(pageId).data`.
 *   - share-link view (`useShareLinkId()` non-null): none of them mount and
 *     `useSWRxInlineComments` is called with `null` (no inline-comment
 *     network request at all) — the client-side defense-in-depth half of
 *     Requirement 6.2. Note PageView.tsx is, today, only ever rendered by
 *     the normal page route (`pages/[[...path]]/index.page.tsx`); the
 *     share-link route renders the separate `ShareLinkPageView` component
 *     instead, which never imports any inline-comment piece. So this
 *     scenario is a guard against a *future* reuse of PageView.tsx under a
 *     share-link context, not a currently-reachable one — see PageView.tsx's
 *     own comment at the `useShareLinkId()` call site for the full
 *     reasoning, and CONCERNS in the task report.
 */

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('./PageContentRenderer', () => ({
  PageContentRenderer: () => <div data-testid="page-content-renderer" />,
}));

// ---- Comments: the EXISTING page-footer comment thread. Must keep
// rendering unchanged, side-by-side with InlineCommentList. ----
type CommentsProps = { pageId: string };
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
vi.mock(
  '~/features/inline-comment/client/components/SelectionCapture/SelectionCapture',
  () => ({
    SelectionCapture: (props: SelectionCaptureProps) => {
      selectionCaptureSpy(props);
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

type InlineCommentListProps = { pageId: string };
const inlineCommentListSpy = vi.fn<(props: InlineCommentListProps) => void>();
vi.mock(
  '~/features/inline-comment/client/components/InlineCommentList/InlineCommentList',
  () => ({
    InlineCommentList: (props: InlineCommentListProps) => {
      inlineCommentListSpy(props);
      return <div data-testid="inline-comment-list" />;
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
}));
vi.mock('~/services/layout/use-should-expand-content', () => ({
  useShouldExpandContent: vi.fn(() => false),
}));
vi.mock('@growi/presentation/dist/services', () => ({
  useSlidesByFrontmatter: vi.fn(() => null),
}));

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
    } as unknown as ReturnType<typeof useSWRxInlineComments>);
    mockedUseShareLinkId.mockReturnValue(undefined);
  });

  describe('normal page view (no share link)', () => {
    it('mounts SelectionCapture, InlineCommentHighlight and InlineCommentList alongside the existing Comments, sharing one container ref with useAnchorResolver', async () => {
      const inlineComments = [buildInlineComment()];
      mockedUseSWRxInlineComments.mockReturnValue({
        data: inlineComments,
      } as unknown as ReturnType<typeof useSWRxInlineComments>);
      mockedUseCurrentPageData.mockReturnValue(buildPage());

      render(
        <PageView pagePath="/test-page" rendererConfig={rendererConfig} />,
      );

      await screen.findByTestId('selection-capture');
      await screen.findByTestId('inline-comment-highlight');
      await screen.findByTestId('inline-comment-list');
      await screen.findByTestId('comments');

      expect(selectionCaptureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: PAGE_ID,
          anchorOriginRevisionId: REVISION_ID,
        }),
      );
      expect(inlineCommentListSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pageId: PAGE_ID }),
      );
      expect(commentsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pageId: PAGE_ID }),
      );

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
  });

  describe('share-link view (useShareLinkId() reports a share link)', () => {
    it('mounts none of the inline-comment UI and makes no inline-comment request', () => {
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
        screen.queryByTestId('inline-comment-list'),
      ).not.toBeInTheDocument();

      // Requirement 6.2's client-side defense-in-depth half: no inline-comment
      // list request is even made when this component is viewed via a share link.
      expect(mockedUseSWRxInlineComments).toHaveBeenCalledWith(null);
      // ...and never with the actual page id, on any render.
      expect(mockedUseSWRxInlineComments).not.toHaveBeenCalledWith(PAGE_ID);
    });
  });
});
