import { type JSX, memo, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';

import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle/index.js';
import type { RendererConfig } from '~/interfaces/services/renderer.js';
import type { IShareLinkHasId } from '~/interfaces/share-link.js';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content.js';
import { useCurrentPageData, usePageNotFound } from '~/states/page/index.js';
import { useViewOptions } from '~/stores/renderer.js';
import loggerFactory from '~/utils/logger/index.js';

import { PageContentFooter } from '../PageView/PageContentFooter.js';
import { PageViewLayout } from '../PageView/PageViewLayout.js';
import ShareLinkAlert from './ShareLinkAlert.js';

const logger = loggerFactory('growi:components:ShareLinkPageView');

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const PageSideContents = dynamic(
  () =>
    import('~/client/components/PageSideContents/index.js').then(
      (mod) => mod.PageSideContents,
    ),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () => import('~/client/components/ForbiddenPage.js'),
  { ssr: false },
);
const SlideRenderer = dynamic(
  () =>
    import('~/client/components/Page/SlideRenderer.js').then(
      (mod) => mod.SlideRenderer,
    ),
  { ssr: false },
);
const PageContentRenderer = dynamic(
  () =>
    import('../PageView/PageContentRenderer.js').then(
      (mod) => mod.PageContentRenderer,
    ),
  { ssr: true },
);
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type Props = {
  pagePath: string;
  rendererConfig: RendererConfig;
  shareLink?: IShareLinkHasId;
  isExpired?: boolean;
  disableLinkSharing: boolean;
};

export const ShareLinkPageView = memo((props: Props): JSX.Element => {
  const { pagePath, rendererConfig, shareLink, isExpired, disableLinkSharing } =
    props;

  const isNotFoundMeta = usePageNotFound();

  const page = useCurrentPageData();

  const { data: viewOptions } = useViewOptions();

  const shouldExpandContent = useShouldExpandContent(page);

  const markdown = page?.revision?.body;

  const isSlide = useSlidesByFrontmatter(
    markdown,
    rendererConfig.isEnabledMarp,
  );

  const isNotFound = isNotFoundMeta || page == null || shareLink == null;

  const specialContents = useMemo(() => {
    if (disableLinkSharing) {
      return <ForbiddenPage isLinkSharingDisabled={props.disableLinkSharing} />;
    }
  }, [disableLinkSharing, props.disableLinkSharing]);

  const headerContents = (
    <PagePathNavTitle
      pageId={page?._id}
      pagePath={pagePath}
      isWipPage={page?.wip}
    />
  );

  const sideContents = !isNotFound ? <PageSideContents page={page} /> : null;

  const footerContents = !isNotFound ? <PageContentFooter page={page} /> : null;

  const Contents = useCallback(() => {
    if (isNotFound || page.revision == null) {
      // biome-ignore lint/complexity/noUselessFragments: ignore
      return <></>;
    }

    if (isExpired) {
      return (
        <h2 className="text-muted mt-4">
          <span className="material-symbols-outlined" aria-hidden="true">
            block
          </span>
          <span> Page is expired</span>
        </h2>
      );
    }

    const markdown = page.revision.body;

    return isSlide != null ? (
      <SlideRenderer marp={isSlide.marp} markdown={markdown} />
    ) : (
      <PageContentRenderer
        rendererOptions={viewOptions}
        rendererConfig={rendererConfig}
        pagePath={pagePath}
        markdown={markdown}
      />
    );
  }, [
    isExpired,
    isSlide,
    pagePath,
    viewOptions,
    page?.revision?.body,
    rendererConfig,
    page?.revision,
    isNotFound,
    isSlide?.marp,
  ]);

  return (
    <PageViewLayout
      headerContents={headerContents}
      sideContents={sideContents}
      expandContentWidth={shouldExpandContent}
      footerContents={footerContents}
    >
      {specialContents}
      {specialContents == null && (
        <>
          {isNotFound && (
            <h2 className="text-muted mt-4">
              <span className="material-symbols-outlined" aria-hidden="true">
                block
              </span>
              <span> Page is not found</span>
            </h2>
          )}
          {!isNotFound && (
            <>
              <ShareLinkAlert
                expiredAt={shareLink.expiredAt}
                createdAt={shareLink.createdAt}
              />
              <div className="mb-5">
                <Contents />
              </div>
            </>
          )}
        </>
      )}
    </PageViewLayout>
  );
});
ShareLinkPageView.displayName = 'ShareLinkPageView';
