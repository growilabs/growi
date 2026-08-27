import { type JSX, memo, useCallback, useId, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { isDeepEquals } from '@growi/core/dist/utils/is-deep-equals';
import { isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';
import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';

import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
// biome-ignore lint/style/noRestrictedImports: client-only hook used in client-only component (must run unconditionally, so it cannot go through next/dynamic like the components below)
import { useAnchorResolver } from '~/features/inline-comment/client/components/AnchorResolver/use-anchor-resolver';
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
import { useViewOptions } from '~/stores/renderer';

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
const InlineCommentList = dynamic(
  () =>
    import(
      '~/features/inline-comment/client/components/InlineCommentList/InlineCommentList'
    ).then((mod) => mod.InlineCommentList),
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

// Custom comparison function for memo to prevent unnecessary re-renders
const arePropsEqual = (prevProps: Props, nextProps: Props): boolean =>
  prevProps.pagePath === nextProps.pagePath &&
  prevProps.className === nextProps.className &&
  isDeepEquals(prevProps.rendererConfig, nextProps.rendererConfig);

const PageViewComponent = (props: Props): JSX.Element => {
  const commentsContainerRef = useRef<HTMLDivElement>(null);
  // Wraps whichever of PageContentRenderer/SlideRenderer is rendered below,
  // giving SelectionCapture/AnchorResolver/InlineCommentHighlight a container
  // scoped to the page body only (excludes the sidebar and the comment
  // threads). RevisionRenderer.tsx already forwards a ref to its own
  // ReactMarkdown-wrapping div (task 5.1); this outer div reads the same
  // rendered text since it contains nothing else, without requiring
  // PageContentRenderer.tsx (a thin dynamic-import wrapper) to also forward
  // a ref through next/dynamic.
  const pageBodyContainerRef = useRef<HTMLDivElement>(null);

  const { pagePath, rendererConfig, className } = props;

  const currentPageId = useCurrentPageId();
  const isIdenticalPathPage = useIsIdenticalPath();
  const isForbidden = useIsForbidden();
  const isNotCreatable = useIsNotCreatable();
  const isNotFoundMeta = usePageNotFound();

  const contentContainerId = useId();

  const page = useCurrentPageData();
  const { data: viewOptions } = useViewOptions();

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

  // Inline comments (Requirements 1.1, 2.1, 2.5, 6.2). PageView.tsx is only
  // ever rendered by the normal page route (`pages/[[...path]]`) — the
  // share-link route renders the separate `ShareLinkPageView` component
  // instead, which this task does not touch, and only THAT route's
  // `useHydratePageAtoms(..., { shareLinkId })` call ever sets
  // `shareLinkIdAtom` (see `pages/share/[[...path]]/index.page.tsx` vs.
  // `pages/[[...path]]/index.page.tsx`). So `useShareLinkId()` is always
  // `undefined` on every route that actually renders this component today.
  // The check below is still added as explicit defense-in-depth (mirrors
  // the client-side `isSharedPage`-style guard other share-link-sensitive UI
  // in this codebase uses) so that if PageView.tsx is ever reused under a
  // share-link context in the future, the inline-comment UI — and the
  // network request below — stay off by construction rather than by the
  // routes happening to stay separate.
  const shareLinkId = useShareLinkId();
  const isSharedPageView = shareLinkId != null;
  const { data: inlineComments } = useSWRxInlineComments(
    isSharedPageView ? null : (page?._id ?? null),
  );
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

  const Contents = useCallback(() => {
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
                resolvedRanges={resolvedInlineCommentRanges}
              />

              <div id="comments-container" ref={commentsContainerRef}>
                <InlineCommentList pageId={page._id} />
                <Comments
                  pageId={page._id}
                  pagePath={pagePath}
                  revision={page.revision}
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
    isSlide,
    isIdenticalPathPage,
    page,
    resolvedInlineCommentRanges,
    isSharedPageView,
  ]);

  return (
    <PageViewLayout
      className={className}
      headerContents={headerContents}
      sideContents={sideContents}
      footerContents={footerContents}
      expandContentWidth={shouldExpandContent}
    >
      <PageAlerts />

      {specialContents}
      {specialContents == null && (
        <>
          {isUsersHomepagePath && page?.creator != null && (
            <UserInfo author={page.creator} />
          )}
          <div id={contentContainerId} className="flex-expand-vert">
            <Contents />
          </div>
        </>
      )}
    </PageViewLayout>
  );
};

export const PageView = memo(PageViewComponent, arePropsEqual);
PageView.displayName = 'PageView';
