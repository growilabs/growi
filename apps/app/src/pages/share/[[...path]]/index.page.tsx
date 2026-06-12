import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useAtomValue } from 'jotai';

import { ShareLinkLayout } from '~/components/Layout/ShareLinkLayout.js';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript/index.js';
import { ShareLinkPageView } from '~/components/ShareLinkPageView/index.js';
import type { CommonEachProps } from '~/pages/common-props/index.js';
import { getServerSideCommonEachProps } from '~/pages/common-props/index.js';
import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils.js';
import { useCustomTitleForPage } from '~/pages/utils/page-title-customization.js';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props.js';
import { useCurrentPageData, useCurrentPagePath } from '~/states/page/index.js';
import { useHydratePageAtoms } from '~/states/page/hydrate.js';
import {
  disableLinkSharingAtom,
  useRendererConfig,
} from '~/states/server-configurations/index.js';

import type { NextPageWithLayout } from '../../_app.page.js';
import { useInitialCSRFetch } from '../../general-page/index.js';
import { useHydrateGeneralPageConfigurationAtoms } from '../../general-page/hydrate.js';
import { registerPageToShowRevisionWithMeta } from '../../general-page/superjson/index.js';
import { NEXT_JS_ROUTING_PAGE } from './consts/index.js';
import { getServerSidePropsForInitial } from './server-side-props.js';
import type { InitialProps } from './types.js';

// call superjson custom register
registerPageToShowRevisionWithMeta();

const GrowiContextualSubNavigation = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Navbar/GrowiContextualSubNavigation.js'),
  { ssr: false },
);

type Props = CommonEachProps | InitialProps;

const isInitialProps = (props: Props): props is InitialProps =>
  props.nextjsRoutingType === NextjsRoutingType.INITIAL;

const SharedPage: NextPageWithLayout<Props> = (props: Props) => {
  // Initialize Jotai atoms with initial data - must be called unconditionally
  const pageData = isInitialProps(props) ? props.pageWithMeta?.data : undefined;
  const pageMeta = isInitialProps(props) ? props.pageWithMeta?.meta : undefined;
  const shareLink = isInitialProps(props) ? props.shareLink : undefined;
  const isExpired = isInitialProps(props) ? props.isExpired : undefined;

  useHydratePageAtoms(pageData, pageMeta, {
    shareLinkId: shareLink?._id,
  });

  const currentPage = useCurrentPageData();
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfig();
  const isLinkSharingDisabled = useAtomValue(disableLinkSharingAtom);

  // Use custom hooks for navigation and routing
  // useSameRouteNavigation();

  // Fetch page data on client-side when SSR is skipped
  useInitialCSRFetch({
    nextjsRoutingType: props.nextjsRoutingType,
    skipSSR: isInitialProps(props) ? props.skipSSR : false,
  });

  // If the data on the page changes without router.push, pageWithMeta remains old because getServerSideProps() is not executed
  // So preferentially take page data from useSWRxCurrentPage
  const pagePath = currentPagePath ?? props.currentPathname;

  const title = useCustomTitleForPage(pagePath);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      <div className="dynamic-layout-root justify-content-between">
        <GrowiContextualSubNavigation currentPage={currentPage} />

        <ShareLinkPageView
          pagePath={pagePath}
          rendererConfig={rendererConfig}
          shareLink={shareLink}
          isExpired={isExpired}
          disableLinkSharing={isLinkSharingDisabled}
        />
      </div>
    </>
  );
};

type LayoutProps = Props & {
  children?: ReactNode;
};

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  // Hydrate sidebar atoms with server-side data - must be called unconditionally
  const initialProps = isInitialProps(props) ? props : undefined;
  useHydrateGeneralPageConfigurationAtoms(
    initialProps?.serverConfig,
    initialProps?.rendererConfig,
  );

  return <ShareLinkLayout>{children}</ShareLinkLayout>;
};

SharedPage.getLayout = function getLayout(page) {
  return (
    <>
      <DrawioViewerScript drawioUri={page.props.rendererConfig.drawioUri} />
      <Layout {...page.props}>{page}</Layout>
    </>
  );
};

// function getAction(props: Props): SupportedActionType {
//   let action: SupportedActionType;
//   if (props.isExpired) {
//     action = SupportedAction.ACTION_SHARE_LINK_EXPIRED_PAGE_VIEW;
//   }
//   else if (props.shareLink == null) {
//     action = SupportedAction.ACTION_SHARE_LINK_NOT_FOUND;
//   }
//   else {
//     action = SupportedAction.ACTION_SHARE_LINK_PAGE_VIEW;
//   }

//   return action;
// }

const emptyProps = {
  props: {},
};

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  //
  // STAGE 1
  //

  const commonEachPropsResult = await getServerSideCommonEachProps(
    context,
    NEXT_JS_ROUTING_PAGE,
  );
  // Handle early return cases (redirect/notFound)
  if (
    'redirect' in commonEachPropsResult ||
    'notFound' in commonEachPropsResult
  ) {
    return commonEachPropsResult;
  }

  //
  // STAGE 2
  //

  const commonEachProps = await commonEachPropsResult.props;

  // Merge all results in a type-safe manner (using sequential merging)
  return mergeGetServerSidePropsResults(
    commonEachPropsResult,
    commonEachProps.nextjsRoutingType === NextjsRoutingType.INITIAL
      ? await getServerSidePropsForInitial(context)
      : emptyProps,
  );
};

export default SharedPage;
