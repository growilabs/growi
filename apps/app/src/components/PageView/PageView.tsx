import {
  type JSX,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import dynamic from 'next/dynamic';
import { isDeepEquals } from '@growi/core/dist/utils/is-deep-equals';
import { isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';
import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';
import { useTranslation } from 'react-i18next';

// biome-ignore lint/style/noRestrictedImports: the existing notification UI, used from this client-only component
import { toastError } from '~/client/util/toastr';
import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
// biome-ignore lint/style/noRestrictedImports: client-only hook used in client-only component (must run unconditionally, so it cannot go through next/dynamic like the components below)
import { useAnchorResolver } from '~/features/inline-comment/client/components/AnchorResolver/use-anchor-resolver';
// biome-ignore lint/style/noRestrictedImports: client-only service used in client-only component
import { rangesById } from '~/features/inline-comment/client/services/resolved-range';
// biome-ignore lint/style/noRestrictedImports: client-only hook used in client-only component (must run unconditionally, so it cannot go through next/dynamic like the components below)
import { useSWRxInlineComments } from '~/features/inline-comment/client/stores/inline-comment';
import type { RendererConfig } from '~/interfaces/services/renderer';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content';
import {
  useCurrentPageData,
  useCurrentPageId,
  useIsForbidden,
  useIsIdenticalPath,
  useIsNotCreatable,
  usePageNotFound,
  useShareLinkId,
} from '~/states/page';
import {
  useCommentForCurrentPageOptions,
  useViewOptions,
} from '~/stores/renderer';

import { UserInfo } from '../User/UserInfo';
import { PageAlerts } from './PageAlerts/PageAlerts';
import { PageContentFooter } from './PageContentFooter';
import { PageViewLayout } from './PageViewLayout';
import { useHashAutoScroll } from './use-hash-auto-scroll';

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const NotCreatablePage = dynamic(
  () =>
    import('~/client/components/NotCreatablePage').then(
      (mod) => mod.NotCreatablePage,
    ),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () => import('~/client/components/ForbiddenPage'),
  { ssr: false },
);
const NotFoundPage = dynamic(() => import('~/client/components/NotFoundPage'), {
  ssr: false,
});
const PageSideContents = dynamic(
  () =>
    import('~/client/components/PageSideContents').then(
      (mod) => mod.PageSideContents,
    ),
  { ssr: false },
);
const PageContentsUtilities = dynamic(
  () =>
    import('~/client/components/Page/PageContentsUtilities').then(
      (mod) => mod.PageContentsUtilities,
    ),
  { ssr: false },
);
const Comments = dynamic(
  () => import('~/client/components/Comments').then((mod) => mod.Comments),
  { ssr: false },
);
const SelectionCapture = dynamic(
  () =>
    import(
      '~/features/inline-comment/client/components/SelectionCapture/SelectionCapture'
    ).then((mod) => mod.SelectionCapture),
  { ssr: false },
);
const InlineCommentHighlight = dynamic(
  () =>
    import(
      '~/features/inline-comment/client/components/InlineCommentHighlight/InlineCommentHighlight'
    ).then((mod) => mod.InlineCommentHighlight),
  { ssr: false },
);
const InlineCommentBodyInteraction = dynamic(
  () =>
    import(
      '~/features/inline-comment/client/components/InlineCommentBodyInteraction/InlineCommentBodyInteraction'
    ).then((mod) => mod.InlineCommentBodyInteraction),
  { ssr: false },
);
const UsersHomepageFooter = dynamic(
  () =>
    import('~/client/components/UsersHomepageFooter').then(
      (mod) => mod.UsersHomepageFooter,
    ),
  { ssr: false },
);
const IdenticalPathPage = dynamic(
  () =>
    import('~/client/components/IdenticalPathPage').then(
      (mod) => mod.IdenticalPathPage,
    ),
  { ssr: false },
);
const SlideRenderer = dynamic(
  () =>
    import('~/client/components/Page/SlideRenderer').then(
      (mod) => mod.SlideRenderer,
    ),
  { ssr: false },
);
const PageContentRenderer = dynamic(
  () => import('./PageContentRenderer').then((mod) => mod.PageContentRenderer),
  { ssr: true },
);
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type Props = {
  pagePath: string;
  rendererConfig: RendererConfig;
  className?: string;
};

// A third CSS.highlights name (alongside the saved-anchor and pending-selection
// ones), registered briefly after scrolling to flash the target range. A Range
// registered under multiple names paints with the later-registered one on top.
const EMPHASIS_HIGHLIGHT_NAME = 'growi-inline-comment-emphasis';

const EMPHASIS_DURATION_MS = 2000;

// Browsers without the CSS Custom Highlight API still scroll — they just get no emphasis.
const supportsCustomHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' &&
  CSS.highlights != null &&
  typeof Highlight !== 'undefined';

/**
 * `Range` has no `scrollIntoView()`, so scrolling goes through the nearest
 * enclosing element. `startContainer` is a `Text` node for any range built
 * from rendered markdown text.
 */
const scrollTargetOf = (range: Range): Element | null =>
  range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;

// Custom comparison function for memo to prevent unnecessary re-renders
const arePropsEqual = (prevProps: Props, nextProps: Props): boolean =>
  prevProps.pagePath === nextProps.pagePath &&
  prevProps.className === nextProps.className &&
  isDeepEquals(prevProps.rendererConfig, nextProps.rendererConfig);

const PageViewComponent = (props: Props): JSX.Element => {
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  // Scopes SelectionCapture/AnchorResolver/InlineCommentHighlight to the page
  // body only (excludes sidebar and comment threads), without requiring
  // PageContentRenderer (a dynamic-import wrapper) to forward its own ref.
  const pageBodyContainerRef = useRef<HTMLDivElement>(null);

  const { pagePath, rendererConfig, className } = props;

  const { t } = useTranslation();

  const currentPageId = useCurrentPageId();
  const isIdenticalPathPage = useIsIdenticalPath();
  const isForbidden = useIsForbidden();
  const isNotCreatable = useIsNotCreatable();
  const isNotFoundMeta = usePageNotFound();

  const contentContainerId = useId();

  const page = useCurrentPageData();
  const { data: viewOptions } = useViewOptions();
  // Inline-comment popovers render comment bodies, not page bodies -- they
  // need the same comment-scoped options (comment-only linebreak setting,
  // @mention highlighting, no page-body-only plugins like plantuml/drawio)
  // that the bottom-of-page comment list already gets via
  // `useCommentForCurrentPageOptions()` inside `PageComment.tsx`.
  const { data: commentRendererOptions } = useCommentForCurrentPageOptions();

  const isNotFound = isNotFoundMeta || page == null;
  const isUsersHomepagePath = isUsersHomepage(pagePath);

  const shouldExpandContent = useShouldExpandContent(page);

  const markdown = page?.revision?.body;
  const isSlide = useSlidesByFrontmatter(
    markdown,
    rendererConfig.isEnabledMarp,
  );

  // Auto-scroll to URL hash target, handling lazy-rendered content
  useHashAutoScroll({ key: currentPageId, contentContainerId });

  // `useShareLinkId()` is always undefined on the routes that render this
  // component today (the share-link route renders a separate component
  // instead) — this check is defense-in-depth so inline comments stay off
  // by construction if that ever changes.
  const shareLinkId = useShareLinkId();
  const isSharedPageView = shareLinkId != null;
  const {
    data: inlineComments,
    resolve: resolveInlineComment,
    createReply: createInlineCommentReply,
    update: updateInlineComment,
    updateReply: updateInlineCommentReply,
    remove: removeInlineComment,
    removeReply: removeInlineCommentReply,
  } = useSWRxInlineComments(isSharedPageView ? null : (page?._id ?? null));
  // Single source of "which comments are visible in the body": both
  // InlineCommentBodyInteraction and visibleResolvedRanges below must derive
  // from this same filtered list. Feeding one the raw list and the other the
  // filtered view previously caused a stuck `pinnedId` after resolving an
  // open popover's comment.
  const bodyInlineComments = useMemo(
    () =>
      (inlineComments ?? []).filter((comment) => comment.resolvedAt == null),
    [inlineComments],
  );
  // Computed for ALL comments, resolved included: list-click scroll navigation
  // must still work for a resolved comment (resolving only suppresses its
  // passive highlight/popover, not its position). Excluding resolved comments
  // here too previously broke `scrollToRange` for resolved list items.
  const inlineCommentAnchors = useMemo(
    () =>
      (inlineComments ?? []).map((comment) => ({
        id: comment.id,
        anchor: comment.anchor,
      })),
    [inlineComments],
  );
  const resolvedInlineCommentRanges = useAnchorResolver(
    pageBodyContainerRef,
    inlineCommentAnchors,
  );
  // Feeds anything that renders a highlight/popover; scrollToRange
  // deliberately uses the unfiltered ranges instead (see inlineCommentAnchors above).
  const visibleResolvedRanges = useMemo(() => {
    const visibleIds = new Set(bodyInlineComments.map((comment) => comment.id));
    return new Map(
      Array.from(resolvedInlineCommentRanges).filter(([id]) =>
        visibleIds.has(id),
      ),
    );
  }, [resolvedInlineCommentRanges, bodyInlineComments]);
  // Adapts the reply-text prop shape to the store's createReply({ comment }) POST body.
  const createInlineCommentReplyText = useCallback(
    (parentId: string, comment: string) =>
      createInlineCommentReply(parentId, { comment }),
    [createInlineCommentReply],
  );

  const emphasisTimeoutRef = useRef<number | undefined>(undefined);
  const clearEmphasis = useCallback(() => {
    if (emphasisTimeoutRef.current != null) {
      window.clearTimeout(emphasisTimeoutRef.current);
      emphasisTimeoutRef.current = undefined;
    }
    if (supportsCustomHighlightApi()) {
      CSS.highlights.delete(EMPHASIS_HIGHLIGHT_NAME);
    }
  }, []);
  // A pending emphasis outlives this component without this: the timeout
  // would fire (or never fire) with the highlight still registered globally.
  useEffect(() => clearEmphasis, [clearEmphasis]);

  const scrollToRange = useCallback(
    (commentId: string): boolean => {
      const container = pageBodyContainerRef.current;
      const range =
        container == null
          ? undefined
          : rangesById(container, resolvedInlineCommentRanges).get(commentId);
      if (range == null) {
        toastError(t('inline_comment.range_not_found'));
        return false;
      }

      scrollTargetOf(range)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      clearEmphasis();
      if (supportsCustomHighlightApi()) {
        CSS.highlights.set(EMPHASIS_HIGHLIGHT_NAME, new Highlight(range));
        emphasisTimeoutRef.current = window.setTimeout(
          clearEmphasis,
          EMPHASIS_DURATION_MS,
        );
      }

      return true;
    },
    [resolvedInlineCommentRanges, clearEmphasis, t],
  );

  const inlineCommentsForComments = useMemo(
    () =>
      inlineComments == null
        ? undefined
        : {
            comments: inlineComments,
            resolve: resolveInlineComment,
            createReply: createInlineCommentReplyText,
            update: updateInlineComment,
            remove: removeInlineComment,
            updateReply: updateInlineCommentReply,
            removeReply: removeInlineCommentReply,
            scrollToRange,
          },
    [
      inlineComments,
      resolveInlineComment,
      createInlineCommentReplyText,
      updateInlineComment,
      removeInlineComment,
      updateInlineCommentReply,
      removeInlineCommentReply,
      scrollToRange,
    ],
  );

  const specialContents = useMemo(() => {
    if (isIdenticalPathPage) {
      return <IdenticalPathPage />;
    }
    if (isForbidden) {
      return <ForbiddenPage />;
    }
    if (isNotCreatable) {
      return <NotCreatablePage />;
    }
  }, [isForbidden, isIdenticalPathPage, isNotCreatable]);

  const headerContents = (
    <PagePathNavTitle
      pageId={page?._id}
      pagePath={pagePath}
      isWipPage={page?.wip}
    />
  );

  const sideContents =
    !isNotFound && !isNotCreatable ? <PageSideContents page={page} /> : null;

  const footerContents =
    !isIdenticalPathPage && !isNotFound ? (
      <>
        {isUsersHomepagePath && page.creator != null && (
          <UsersHomepageFooter creatorId={page.creator._id} />
        )}
        <PageContentFooter page={page} />
      </>
    ) : null;

  // Must stay a memoized element, not a component (`useCallback` + `<Contents />`):
  // a new function identity per dependency change made React remount this
  // subtree, discarding SelectionCapture's in-progress inline-comment form.
  const contents = useMemo(() => {
    if (isNotFound || page?.revision == null) {
      return <NotFoundPage path={pagePath} />;
    }

    const markdown = page.revision.body;

    return (
      <>
        <PageContentsUtilities />

        <div className="flex-expand-vert justify-content-between">
          <div ref={pageBodyContainerRef}>
            {isSlide != null ? (
              <SlideRenderer marp={isSlide.marp} markdown={markdown} />
            ) : (
              <PageContentRenderer
                rendererOptions={viewOptions}
                rendererConfig={rendererConfig}
                pagePath={pagePath}
                markdown={markdown}
              />
            )}
          </div>

          {!isIdenticalPathPage && !isNotFound && !isSharedPageView && (
            <>
              <SelectionCapture
                containerRef={pageBodyContainerRef}
                pageId={page._id}
                anchorOriginRevisionId={page.revision._id}
              />
              <InlineCommentHighlight
                containerRef={pageBodyContainerRef}
                resolvedRanges={visibleResolvedRanges}
              />
              <InlineCommentBodyInteraction
                containerRef={pageBodyContainerRef}
                resolvedRanges={visibleResolvedRanges}
                inlineComments={bodyInlineComments}
                createReply={createInlineCommentReplyText}
                resolve={resolveInlineComment}
                update={updateInlineComment}
                remove={removeInlineComment}
                updateReply={updateInlineCommentReply}
                removeReply={removeInlineCommentReply}
                rendererOptions={commentRendererOptions}
              />

              <div id="comments-container" ref={commentsContainerRef}>
                <Comments
                  pageId={page._id}
                  pagePath={pagePath}
                  revision={page.revision}
                  inlineComments={inlineCommentsForComments}
                />
              </div>
            </>
          )}
        </div>
      </>
    );
  }, [
    isNotFound,
    page?.revision,
    page?._id,
    rendererConfig,
    pagePath,
    viewOptions,
    commentRendererOptions,
    isSlide,
    isIdenticalPathPage,
    page,
    visibleResolvedRanges,
    isSharedPageView,
    inlineCommentsForComments,
    bodyInlineComments,
    createInlineCommentReplyText,
    resolveInlineComment,
    updateInlineComment,
    removeInlineComment,
    updateInlineCommentReply,
    removeInlineCommentReply,
  ]);

  return (
    <PageViewLayout
      className={className}
      headerContents={headerContents}
      sideContents={sideContents}
      footerContents={footerContents}
      expandContentWidth={shouldExpandContent}
    >
      {/* Declared globally: CSS.highlights is a document-level registry, not component-scoped. */}
      <style jsx global>
        {`
          ::highlight(${EMPHASIS_HIGHLIGHT_NAME}) {
            background-color: var(--grw-marker-bg-red);
          }
        `}
      </style>

      <PageAlerts />

      {specialContents}
      {specialContents == null && (
        <>
          {isUsersHomepagePath && page?.creator != null && (
            <UserInfo author={page.creator} />
          )}
          <div id={contentContainerId} className="flex-expand-vert">
            {contents}
          </div>
        </>
      )}
    </PageViewLayout>
  );
};

export const PageView = memo(PageViewComponent, arePropsEqual);
PageView.displayName = 'PageView';
