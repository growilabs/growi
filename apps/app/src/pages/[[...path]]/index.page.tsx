import type { ReactNode, JSX } from 'react';
import React, { useEffect } from 'react';

import EventEmitter from 'events';

import { isClient } from '@growi/core/dist/utils';
import type {
  GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { PageView } from '~/components/PageView/PageView';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { useEditorModeClassName } from '~/services/layout/use-editor-mode-class-name';
import {
  useCurrentPageData, useCurrentPageId, useCurrentPagePath, usePageNotFound,
} from '~/states/page';
import { useHydratePageAtoms } from '~/states/page/hydrate';
import { useRedirectFrom } from '~/states/page/redirect';
import { useRendererConfig } from '~/states/server-configurations';
import { useSetupGlobalSocket, useSetupGlobalSocketForPage } from '~/states/socket-io';
import { useEditingMarkdown } from '~/states/ui/editor';
import { useSWRMUTxCurrentPageYjsData } from '~/stores/yjs';

import type { NextPageWithLayout } from '../_app.page';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate';
import { getServerSideCommonEachProps } from '../common-props';
import type { GeneralPageInitialProps } from '../general-page';
import { useInitialCSRFetch } from '../general-page';
import { useHydrateGeneralPageConfigurationAtoms } from '../general-page/hydrate';
import { registerPageToShowRevisionWithMeta } from '../general-page/superjson';
import { NextjsRoutingType, detectNextjsRoutingType } from '../utils/nextjs-routing-utils';
import { useCustomTitleForPage } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

import { NEXT_JS_ROUTING_PAGE } from './consts';
import { getServerSidePropsForInitial, getServerSidePropsForSameRoute } from './server-side-props';
import type { EachProps } from './types';
import { useSameRouteNavigation } from './use-same-route-navigation';
import { useShallowRouting } from './use-shallow-routing';

// call superjson custom register
registerPageToShowRevisionWithMeta();

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}

const GrowiContextualSubNavigation = dynamic(() => import('~/client/components/Navbar/GrowiContextualSubNavigation'), { ssr: false });

const GrowiPluginsActivator = dynamic(() => import('~/features/growi-plugin/client/components').then(mod => mod.GrowiPluginsActivator), { ssr: false });

const DisplaySwitcher = dynamic(() => import('~/client/components/Page/DisplaySwitcher').then(mod => mod.DisplaySwitcher), { ssr: false });
const PageStatusAlert = dynamic(() => import('~/client/components/PageStatusAlert').then(mod => mod.PageStatusAlert), { ssr: false });

const UnsavedAlertDialog = dynamic(() => import('~/client/components/UnsavedAlertDialog'), { ssr: false });
const DescendantsPageListModal = dynamic(
  () => import('~/client/components/DescendantsPageListModal').then(mod => mod.DescendantsPageListModal),
  { ssr: false },
);
const DrawioModal = dynamic(() => import('~/client/components/PageEditor/DrawioModal').then(mod => mod.DrawioModal), { ssr: false });
const HandsontableModal = dynamic(() => import('~/client/components/PageEditor/HandsontableModal').then(mod => mod.HandsontableModal), { ssr: false });
const TemplateModal = dynamic(() => import('~/client/components/TemplateModal').then(mod => mod.TemplateModal), { ssr: false });
const LinkEditModal = dynamic(() => import('~/client/components/PageEditor/LinkEditModal').then(mod => mod.LinkEditModal), { ssr: false });
const TagEditModal = dynamic(() => import('~/client/components/PageTags/TagEditModal').then(mod => mod.TagEditModal), { ssr: false });
const ConflictDiffModal = dynamic(() => import('~/client/components/PageEditor/ConflictDiffModal').then(mod => mod.ConflictDiffModal), { ssr: false });

const EditablePageEffects = dynamic(() => import('~/client/components/Page/EditablePageEffects').then(mod => mod.EditablePageEffects), { ssr: false });

type InitialProps = EachProps & GeneralPageInitialProps & BasicLayoutConfigurationProps;
type Props = EachProps | InitialProps;

const isInitialProps = (props: Props): props is InitialProps => {
  return 'isNextjsRoutingTypeInitial' in props && props.isNextjsRoutingTypeInitial;
};


const Page: NextPageWithLayout<Props> = (props: Props) => {

  // register global EventEmitter
  if (isClient() && window.globalEmitter == null) {
    window.globalEmitter = new EventEmitter();
  }

  // Initialize Jotai atoms with initial data - must be called unconditionally
  const pageData = isInitialProps(props) ? props.pageWithMeta?.data : undefined;
  useHydratePageAtoms(pageData);

  const currentPage = useCurrentPageData();
  const pageId = useCurrentPageId();
  const currentPagePath = useCurrentPagePath();
  const isNotFound = usePageNotFound();
  const rendererConfig = useRendererConfig();
  const [, setRedirectFrom] = useRedirectFrom();
  const [, setEditingMarkdown] = useEditingMarkdown();

  const { trigger: mutateCurrentPageYjsDataFromApi } = useSWRMUTxCurrentPageYjsData();

  // setup socket.io
  useSetupGlobalSocket();
  useSetupGlobalSocketForPage();

  // Use custom hooks for navigation and routing
  useSameRouteNavigation();
  useShallowRouting(props);

  // If initial props and skipSSR, fetch page data on client-side
  useInitialCSRFetch(isInitialProps(props) && props.skipSSR);

  // Initialize redirectFrom atom values
  useEffect(() => {
    setRedirectFrom(props.redirectFrom ?? null);
    // cleanup
    return () => setRedirectFrom(null);
  }, [props.redirectFrom, setRedirectFrom]);

  // Optimized effects with minimal dependencies
  useEffect(() => {
    // Load YJS data only when revision changes and page exists
    if (pageId && currentPage?.revision?._id && !isNotFound) {
      mutateCurrentPageYjsDataFromApi();
    }
  }, [currentPage?.revision?._id, mutateCurrentPageYjsDataFromApi, isNotFound, pageId]);

  useEffect(() => {
    // Initialize editing markdown only when page path changes
    if (currentPagePath) {
      setEditingMarkdown(currentPage?.revision?.body || '');
    }
  }, [currentPagePath, currentPage?.revision?.body, setEditingMarkdown]);

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

const BasicLayoutWithEditor = ({ children }: { children?: ReactNode }): JSX.Element => {
  const editorModeClassName = useEditorModeClassName();
  return <BasicLayout className={editorModeClassName}>{children}</BasicLayout>;
};

type LayoutProps = Props & {
  children?: ReactNode
}

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  // Hydrate sidebar atoms with server-side data - must be called unconditionally
  const initialProps = isInitialProps(props) ? props : undefined;
  useHydrateBasicLayoutConfigurationAtoms(initialProps?.searchConfig, initialProps?.sidebarConfig, initialProps?.userUISettings);
  useHydrateGeneralPageConfigurationAtoms(initialProps?.serverConfig, initialProps?.rendererConfig);

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

      <Layout {...page.props}>
        {page}
      </Layout>
      <UnsavedAlertDialog />
      <DescendantsPageListModal />
      <DrawioModal />
      <HandsontableModal />
      <TemplateModal />
      <LinkEditModal />
      <TagEditModal />
      <ConflictDiffModal />
    </>
  );
};

export const getServerSideProps: GetServerSideProps<Props> = async(context: GetServerSidePropsContext) => {
  //
  // STAGE 1
  //

  const commonEachPropsResult = await getServerSideCommonEachProps(context, NEXT_JS_ROUTING_PAGE);
  // Handle early return cases (redirect/notFound)
  if ('redirect' in commonEachPropsResult || 'notFound' in commonEachPropsResult) {
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

  // detect Next.js routing type
  const nextjsRoutingType = detectNextjsRoutingType(context, NEXT_JS_ROUTING_PAGE);

  // Merge all results in a type-safe manner (using sequential merging)
  return mergeGetServerSidePropsResults(commonEachPropsResult, (
    (nextjsRoutingType === NextjsRoutingType.INITIAL)
      ? await getServerSidePropsForInitial(context)
      : await getServerSidePropsForSameRoute(context)
  ));
};

export default Page;
