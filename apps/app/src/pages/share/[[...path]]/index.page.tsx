import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useAtomValue } from 'jotai';

import { ShareLinkLayout } from '~/components/Layout/ShareLinkLayout';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { ShareLinkPageView } from '~/components/ShareLinkPageView';
import { getServerSideCommonEachProps } from '~/pages/common-props';
import { NextjsRoutingType } from '~/pages/utils/nextjs-routing-utils';
import { useCustomTitleForPage } from '~/pages/utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props';
import { useCurrentPageData, useCurrentPagePath } from '~/states/page';
import { useHydratePageAtoms } from '~/states/page/hydrate';
import {
  disableLinkSharingAtom,
  useRendererConfig,
} from '~/states/server-configurations';

import type { NextPageWithLayout } from '../../_app.page';
import { useHydrateGeneralPageConfigurationAtoms } from '../../general-page/hydrate';
import { registerPageToShowRevisionWithMeta } from '../../general-page/superjson';
import { NEXT_JS_ROUTING_PAGE } from './consts';
import {
  getServerSidePropsForInitial,
  getServerSidePropsForSameRoute,
} from './server-side-props';
import type { EachProps, InitialProps } from './types';
import { useSharedPageCSRFetch } from './use-shared-page-csr-fetch';

// call superjson custom register
registerPageToShowRevisionWithMeta();

const GrowiContextualSubNavigation = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Navbar/GrowiContextualSubNavigation'),
  { ssr: false },
);

type Props = EachProps | InitialProps;

const isInitialProps = (props: Props): props is InitialProps =>
  props.nextjsRoutingType !== NextjsRoutingType.SAME_ROUTE;

const SharedPage: NextPageWithLayout<Props> = (props: Props) => {
  const { pageWithMeta, shareLink, isExpired } = props;

  // Initialize Jotai atoms with initial data - must be called unconditionally
  useHydratePageAtoms(pageWithMeta?.data ?? undefined, pageWithMeta?.meta, {
    shareLinkId: shareLink?._id,
  });

  const currentPage = useCurrentPageData();
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfig();
  const isLinkSharingDisabled = useAtomValue(disableLinkSharingAtom);

  // Fetch page data on client-side when SSR is skipped or navigated client-side
  useSharedPageCSRFetch({
    nextjsRoutingType: props.nextjsRoutingType,
    skipSSR: props.skipSSR,
    pageId: pageWithMeta?.data?._id,
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

// props.rendererConfig is absent on SAME_ROUTE navigation, so read the hydrated atom
const DrawioViewerScriptWithAtom = (): JSX.Element => {
  const rendererConfig = useRendererConfig();
  return <DrawioViewerScript drawioUri={rendererConfig.drawioUri} />;
};

SharedPage.getLayout = function getLayout(page) {
  return (
    <>
      <DrawioViewerScriptWithAtom />
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
    commonEachProps.nextjsRoutingType === NextjsRoutingType.SAME_ROUTE
      ? await getServerSidePropsForSameRoute(context)
      : await getServerSidePropsForInitial(context),
  );
};

export default SharedPage;
