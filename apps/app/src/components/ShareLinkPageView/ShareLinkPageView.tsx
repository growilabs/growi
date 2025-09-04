import { useMemo, memo, type JSX } from 'react';

import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';
import dynamic from 'next/dynamic';

import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { IShareLinkHasId } from '~/interfaces/share-link';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content';
import { generateSSRViewOptions } from '~/services/renderer/renderer';
import { useCurrentPageData, usePageNotFound } from '~/states/page';
import { useViewOptions } from '~/stores/renderer';
import loggerFactory from '~/utils/logger';

import { PageContentFooter } from '../PageView/PageContentFooter';
import { PageViewLayout } from '../PageView/PageViewLayout';
import RevisionRenderer from '../PageView/RevisionRenderer';

import ShareLinkAlert from './ShareLinkAlert';


const logger = loggerFactory('growi:components:ShareLinkPageView');


const PageSideContents = dynamic(() => import('~/client/components/PageSideContents').then(mod => mod.PageSideContents), { ssr: false });
const ForbiddenPage = dynamic(() => import('~/client/components/ForbiddenPage'), { ssr: false });
const SlideRenderer = dynamic(() => import('~/client/components/Page/SlideRenderer').then(mod => mod.SlideRenderer), { ssr: false });

type Props = {
  pagePath: string,
  rendererConfig: RendererConfig,
  shareLink?: IShareLinkHasId,
  isExpired?: boolean,
  disableLinkSharing: boolean,
}

export const ShareLinkPageView = memo((props: Props): JSX.Element => {
  const {
    pagePath, rendererConfig,
    shareLink,
    isExpired, disableLinkSharing,
  } = props;

  const isNotFoundMeta = usePageNotFound();

  const page = useCurrentPageData();

  const { data: viewOptions } = useViewOptions();

  const shouldExpandContent = useShouldExpandContent(page);

  const markdown = page?.revision?.body;

  const isSlide = useSlidesByFrontmatter(markdown, rendererConfig.isEnabledMarp);

  const isNotFound = isNotFoundMeta || page == null || shareLink == null;

  const specialContents = useMemo(() => {
    if (disableLinkSharing) {
      return <ForbiddenPage isLinkSharingDisabled={props.disableLinkSharing} />;
    }
  }, [disableLinkSharing, props.disableLinkSharing]);

  const headerContents = <PagePathNavTitle pageId={page?._id} pagePath={pagePath} isWipPage={page?.wip} />;

  const sideContents = !isNotFound
    ? (
      <PageSideContents page={page} />
    )
    : null;


  const footerContents = !isNotFound
    ? (
      <PageContentFooter page={page} />
    )
    : null;

  const Contents = () => {
    if (isNotFound || page.revision == null) {
      return <></>;
    }

    if (isExpired) {
      return (
        <>
          <h2 className="text-muted mt-4">
            <span className="material-symbols-outlined" aria-hidden="true">block</span>
            <span> Page is expired</span>
          </h2>
        </>
      );
    }

    const rendererOptions = viewOptions ?? generateSSRViewOptions(rendererConfig, pagePath);
    const markdown = page.revision.body;

    return isSlide != null
      ? <SlideRenderer marp={isSlide.marp} markdown={markdown} />
      : <RevisionRenderer rendererOptions={rendererOptions} markdown={markdown} />;
  };

  return (
    <PageViewLayout
      headerContents={headerContents}
      sideContents={sideContents}
      expandContentWidth={shouldExpandContent}
      footerContents={footerContents}
    >
      { specialContents }
      { specialContents == null && (
        <>
          { isNotFound && (
            <h2 className="text-muted mt-4">
              <span className="material-symbols-outlined" aria-hidden="true">block</span>
              <span> Page is not found</span>
            </h2>
          ) }
          { !isNotFound && (
            <>
              <ShareLinkAlert expiredAt={shareLink.expiredAt} createdAt={shareLink.createdAt} />
              <div className="mb-5">
                <Contents />
              </div>
            </>
          ) }
        </>
      ) }
    </PageViewLayout>
  );
});
ShareLinkPageView.displayName = 'ShareLinkPageView';
