import React, {
  useEffect, useMemo, useRef, useState, type JSX,
} from 'react';

import type { IPagePopulatedToShowRevision } from '@growi/core';
import { isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';
import { useSlidesByFrontmatter } from '@growi/presentation/dist/services';
import dynamic from 'next/dynamic';

import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
import type { RendererConfig } from '~/interfaces/services/renderer';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content';
import { generateSSRViewOptions } from '~/services/renderer/renderer';
import {
  useIsForbidden, useIsIdenticalPath, useIsNotCreatable,
} from '~/stores-universal/context';
import { useSWRxCurrentPage, useIsNotFound } from '~/stores/page';
import { useViewOptions } from '~/stores/renderer';

import { UserInfo } from '../User/UserInfo';

import { PageAlerts } from './PageAlerts/PageAlerts';
import { PageContentFooter } from './PageContentFooter';
import { PageViewLayout } from './PageViewLayout';
import RevisionRenderer from './RevisionRenderer';


const NotCreatablePage = dynamic(() => import('~/client/components/NotCreatablePage').then(mod => mod.NotCreatablePage), { ssr: false });
const ForbiddenPage = dynamic(() => import('~/client/components/ForbiddenPage'), { ssr: false });
const NotFoundPage = dynamic(() => import('~/client/components/NotFoundPage'), { ssr: false });
const PageSideContents = dynamic(() => import('~/client/components/PageSideContents').then(mod => mod.PageSideContents), { ssr: false });
const PageContentsUtilities = dynamic(() => import('~/client/components/Page/PageContentsUtilities').then(mod => mod.PageContentsUtilities), { ssr: false });
const Comments = dynamic(() => import('~/client/components/Comments').then(mod => mod.Comments), { ssr: false });
const UsersHomepageFooter = dynamic(() => import('~/client/components/UsersHomepageFooter')
  .then(mod => mod.UsersHomepageFooter), { ssr: false });
const IdenticalPathPage = dynamic(() => import('~/client/components/IdenticalPathPage').then(mod => mod.IdenticalPathPage), { ssr: false });
const SlideRenderer = dynamic(() => import('~/client/components/Page/SlideRenderer').then(mod => mod.SlideRenderer), { ssr: false });


type Props = {
  pagePath: string,
  rendererConfig: RendererConfig,
  initialPage?: IPagePopulatedToShowRevision,
  className?: string,
}

export const PageView = (props: Props): JSX.Element => {

  const commentsContainerRef = useRef<HTMLDivElement>(null);

  const {
    pagePath, initialPage, rendererConfig, className,
  } = props;

  const { data: isIdenticalPathPage } = useIsIdenticalPath();
  const { data: isForbidden } = useIsForbidden();
  const { data: isNotCreatable } = useIsNotCreatable();
  const { data: isNotFoundMeta } = useIsNotFound();

  const { data: pageBySWR } = useSWRxCurrentPage();
  const { data: viewOptions } = useViewOptions();

  const page = pageBySWR ?? initialPage;
  const isNotFound = isNotFoundMeta || page == null;
  const isUsersHomepagePath = isUsersHomepage(pagePath);

  const shouldExpandContent = useShouldExpandContent(page);


  const markdown = page?.revision?.body;
  const isSlide = useSlidesByFrontmatter(markdown, rendererConfig.isEnabledMarp);

  const [currentPageId, setCurrentPageId] = useState<string | undefined>(page?._id);

  useEffect(() => {
    if (page?._id !== undefined) {
      setCurrentPageId(page._id);
    }
  }, [page?._id]);

  // ***************************  Auto Scroll  ***************************
  useEffect(() => {
    if (currentPageId == null) {
      return;
    }

    // do nothing if hash is empty
    const { hash } = window.location;
    if (hash.length === 0) {
      return;
    }

    const contentContainer = document.getElementById('page-view-content-container');
    if (contentContainer == null) return;

    const targetId = decodeURIComponent(hash.slice(1));
    const target = document.getElementById(targetId);
    if (target != null) {
      target.scrollIntoView();
      return;
    }

    const observer = new MutationObserver(() => {
      const target = document.getElementById(targetId);
      if (target != null) {
        target.scrollIntoView();
        observer.disconnect();
      }
    });

    observer.observe(contentContainer, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [currentPageId]);

  // *******************************  end  *******************************

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

  const headerContents = <PagePathNavTitle pageId={page?._id} pagePath={pagePath} isWipPage={page?.wip} />;

  const sideContents = !isNotFound && !isNotCreatable
    ? (
      <PageSideContents page={page} />
    )
    : null;

  const footerContents = !isIdenticalPathPage && !isNotFound
    ? (
      <>
        {(isUsersHomepagePath && page.creator != null) && (
          <UsersHomepageFooter creatorId={page.creator._id} />
        )}
        <PageContentFooter page={page} />
      </>
    )
    : null;

  const Contents = () => {
    if (isNotFound || page?.revision == null) {
      return <NotFoundPage path={pagePath} />;
    }

    const markdown = page.revision.body;
    const rendererOptions = viewOptions ?? generateSSRViewOptions(rendererConfig, pagePath);

    return (
      <>
        <PageContentsUtilities />

        <div className="flex-expand-vert justify-content-between">

          { isSlide != null
            ? <SlideRenderer marp={isSlide.marp} markdown={markdown} />
            : <RevisionRenderer rendererOptions={rendererOptions} markdown={markdown} />
          }

          { !isIdenticalPathPage && !isNotFound && (
            <div id="comments-container" ref={commentsContainerRef}>
              <Comments
                pageId={page._id}
                pagePath={pagePath}
                revision={page.revision}
              />
            </div>
          ) }
        </div>
      </>
    );
  };

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
          {(isUsersHomepagePath && page?.creator != null) && <UserInfo author={page.creator} />}
          <div id="page-view-content-container" className="flex-expand-vert">
            <Contents />
          </div>
        </>
      )}

    </PageViewLayout>
  );
};
