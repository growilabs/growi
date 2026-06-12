import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { isIPageInfo } from '@growi/core';

// biome-ignore-start lint/style/noRestrictedImports: no-problem lazy loaded components
import { DescendantsPageListModalLazyLoaded } from '~/client/components/DescendantsPageListModal/index.js';
import { ConflictDiffModalLazyLoaded } from '~/client/components/PageEditor/ConflictDiffModal/index.js';
import { DrawioModalLazyLoaded } from '~/client/components/PageEditor/DrawioModal/index.js';
import { HandsontableModalLazyLoaded } from '~/client/components/PageEditor/HandsontableModal/index.js';
import { LinkEditModalLazyLoaded } from '~/client/components/PageEditor/LinkEditModal/index.js';
import { TagEditModalLazyLoaded } from '~/client/components/PageTags/TagEditModal/index.js';
import { TemplateModalLazyLoaded } from '~/client/components/TemplateModal/index.js';

// biome-ignore-end lint/style/noRestrictedImports: no-problem lazy loaded components

import { BasicLayout } from '~/components/Layout/BasicLayout.js';
import { PageView } from '~/components/PageView/PageView.js';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript/index.js';
import { useEditorModeClassName } from '~/services/layout/use-editor-mode-class-name.js';
import { useCurrentPageData, useCurrentPagePath } from '~/states/page/index.js';
import { useHydratePageAtoms } from '~/states/page/hydrate.js';
import { useRendererConfig } from '~/states/server-configurations/index.js';
import {
  useSetupGlobalSocket,
  useSetupGlobalSocketForPage,
} from '~/states/socket-io/index.js';
import { useSetEditingMarkdown } from '~/states/ui/editor/index.js';
import { useSWRxPageInfo } from '~/stores/page.js';

import type { NextPageWithLayout } from '../_app.page.js';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate.js';
import { getServerSideCommonEachProps } from '../common-props/index.js';
import { useInitialCSRFetch } from '../general-page/index.js';
import { useHydrateGeneralPageConfigurationAtoms } from '../general-page/hydrate.js';
import { registerPageToShowRevisionWithMeta } from '../general-page/superjson/index.js';
import { NextjsRoutingType } from '../utils/nextjs-routing-utils.js';
import { useCustomTitleForPage } from '../utils/page-title-customization.js';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props.js';
import { NEXT_JS_ROUTING_PAGE } from './consts/index.js';
import {
  getServerSidePropsForInitial,
  getServerSidePropsForSameRoute,
} from './server-side-props.js';
import type { EachProps, InitialProps } from './types.js';
import { useSameRouteNavigation } from './use-same-route-navigation.js';
import { useShallowRouting } from './use-shallow-routing.js';
import { useSyncRevisionIdFromUrl } from './use-sync-revision-id-from-url.js';

// call superjson custom register
registerPageToShowRevisionWithMeta();

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const GrowiContextualSubNavigation = dynamic(
  () => import('~/client/components/Navbar/GrowiContextualSubNavigation.js'),
  { ssr: false },
);
const GrowiPluginsActivator = dynamic(
  () =>
    import(
      '~/features/growi-plugin/client/components/GrowiPluginsActivator.js'
    ).then((mod) => mod.GrowiPluginsActivator),
  { ssr: false },
);
const DisplaySwitcher = dynamic(
  () =>
    import('~/client/components/Page/DisplaySwitcher.js').then(
      (mod) => mod.DisplaySwitcher,
    ),
  { ssr: false },
);
const PageStatusAlert = dynamic(
  () =>
    import('~/client/components/PageStatusAlert.js').then(
      (mod) => mod.PageStatusAlert,
    ),
  { ssr: false },
);
const UnsavedAlertDialog = dynamic(
  () => import('~/client/components/UnsavedAlertDialog.js'),
  { ssr: false },
);
const EditablePageEffects = dynamic(
  () =>
    import('~/client/components/Page/EditablePageEffects.js').then(
      (mod) => mod.EditablePageEffects,
    ),
  { ssr: false },
);
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type Props = EachProps | InitialProps;

const isInitialProps = (props: Props): props is InitialProps =>
  props.nextjsRoutingType !== NextjsRoutingType.SAME_ROUTE;

const Page: NextPageWithLayout<Props> = (props: Props) => {
  // Initialize Jotai atoms with initial data - must be called unconditionally
  const pageData = isInitialProps(props) ? props.pageWithMeta?.data : undefined;
  const pageMeta = isInitialProps(props) ? props.pageWithMeta?.meta : undefined;

  useHydratePageAtoms(pageData, pageMeta, {
    redirectFrom: props.redirectFrom,
    isIdenticalPath: props.isIdenticalPathPage,
    templateTags: props.templateTagData,
    templateBody: props.templateBodyData,
  });

  const currentPage = useCurrentPageData();
  const currentPagePath = useCurrentPagePath();
  const rendererConfig = useRendererConfig();
  const setEditingMarkdown = useSetEditingMarkdown();

  // Sync URL query parameter to atom
  useSyncRevisionIdFromUrl();

  // setup socket.io
  useSetupGlobalSocket();
  useSetupGlobalSocketForPage();

  // Use custom hooks for navigation and routing
  useSameRouteNavigation();
  useShallowRouting(props);

  // Fetch page data on client-side when SSR is skipped or navigating from outside
  useInitialCSRFetch({
    nextjsRoutingType: props.nextjsRoutingType,
    skipSSR: isInitialProps(props) ? props.skipSSR : false,
  });

  useEffect(() => {
    // Initialize editing markdown only when page path changes
    if (currentPagePath) {
      setEditingMarkdown(currentPage?.revision?.body || '');
    }
  }, [currentPagePath, currentPage?.revision?.body, setEditingMarkdown]);

  // Optimistically update PageInfo SWR cache with SSR data
  const { mutate: mutatePageInfo } = useSWRxPageInfo(currentPage?._id);
  useEffect(() => {
    if (isInitialProps(props) && pageMeta != null && isIPageInfo(pageMeta)) {
      mutatePageInfo(pageMeta, { revalidate: false });
    }
  }, [pageMeta, mutatePageInfo, props]);

  // If the data on the page changes without router.push, pageWithMeta remains old because getServerSideProps() is not executed
  // So preferentially take page data from useSWRxCurrentPage
  // Note: Memoize to prevent unnecessary re-renders of PageView
  const pagePath = useMemo(
    () => currentPagePath ?? props.currentPathname,
    [currentPagePath, props.currentPathname],
  );

  const title = useCustomTitleForPage(pagePath);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root justify-content-between">
        <GrowiContextualSubNavigation currentPage={currentPage} />

        <PageView
          className="d-edit-none"
          pagePath={pagePath}
          rendererConfig={rendererConfig}
        />

        <EditablePageEffects />
        <DisplaySwitcher />

        <PageStatusAlert />
      </div>
    </>
  );
};

const BasicLayoutWithEditor = ({
  children,
}: {
  children?: ReactNode;
}): JSX.Element => {
  const editorModeClassName = useEditorModeClassName();
  return <BasicLayout className={editorModeClassName}>{children}</BasicLayout>;
};

type LayoutProps = Props & {
  children?: ReactNode;
};

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  // Hydrate sidebar atoms with server-side data - must be called unconditionally
  const initialProps = isInitialProps(props) ? props : undefined;
  useHydrateBasicLayoutConfigurationAtoms(
    initialProps?.searchConfig,
    initialProps?.sidebarConfig,
    initialProps?.userUISettings,
  );
  useHydrateGeneralPageConfigurationAtoms(
    initialProps?.serverConfig,
    initialProps?.rendererConfig,
  );

  return <BasicLayoutWithEditor>{children}</BasicLayoutWithEditor>;
};

Page.getLayout = function getLayout(page: React.ReactElement<Props>) {
  // Get drawioUri from rendererConfig atom to ensure consistency across navigations
  const DrawioViewerScriptWithAtom = (): JSX.Element => {
    const rendererConfig = useRendererConfig();
    return <DrawioViewerScript drawioUri={rendererConfig.drawioUri} />;
  };

  return (
    <>
      <GrowiPluginsActivator />
      <DrawioViewerScriptWithAtom />

      <Layout {...page.props}>{page}</Layout>
      <UnsavedAlertDialog />
      <DescendantsPageListModalLazyLoaded />
      <DrawioModalLazyLoaded />
      <HandsontableModalLazyLoaded />
      <TemplateModalLazyLoaded />
      <LinkEditModalLazyLoaded />
      <TagEditModalLazyLoaded />
      <ConflictDiffModalLazyLoaded />
    </>
  );
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
  const commonEachProps = await commonEachPropsResult.props;

  // Handle redirect destination from common props
  if (commonEachProps.redirectDestination != null) {
    return {
      redirect: {
        permanent: false,
        destination: commonEachProps.redirectDestination,
      },
    };
  }

  //
  // STAGE 2
  //

  // Merge all results in a type-safe manner (using sequential merging)
  return mergeGetServerSidePropsResults(
    commonEachPropsResult,
    commonEachProps.nextjsRoutingType === NextjsRoutingType.SAME_ROUTE
      ? await getServerSidePropsForSameRoute(context)
      : await getServerSidePropsForInitial(context),
  );
};

export default Page;
