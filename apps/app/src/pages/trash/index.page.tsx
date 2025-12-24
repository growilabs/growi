import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {
  isPermalink,
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';

// biome-ignore lint/style/noRestrictedImports: no-problem lazy loaded components
import { EmptyTrashModalLazyLoaded } from '~/client/components/EmptyTrashModal';
import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { NextPageWithLayout } from '../_app.page';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import { getServerSideBasicLayoutProps } from '../basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import type { RendererConfigProps } from '../general-page';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { ServerConfigurationProps } from './types';
import { useHydrateServerConfigurationAtoms } from './use-hydrate-server-configurations';

const TrashPageList = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/TrashPageList').then(
      (mod) => mod.TrashPageList,
    ),
  { ssr: false },
);

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps &
  ServerConfigurationProps &
  RendererConfigProps;

const TrashPage: NextPageWithLayout<Props> = (props: Props) => {
  // // clear the cache for the current page
  // //  in order to fix https://redmine.weseek.co.jp/issues/135811
  // useHydratePageAtoms(undefined);
  // useCurrentPathname('/trash');

  // Hydrate server-side data
  useHydrateServerConfigurationAtoms(props.serverConfig);

  const title = useCustomTitle('/trash');

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar">
          <div className="container-lg wide-gutter-x-lg">
            <PagePathNavTitle pagePath="/trash" />
            <TrashPageList />
          </div>
        </div>
      </div>
    </>
  );
};

type LayoutProps = Props & {
  children?: ReactNode;
};

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  useHydrateBasicLayoutConfigurationAtoms(
    props.searchConfig,
    props.sidebarConfig,
    props.userUISettings,
  );

  return <BasicLayout>{children}</BasicLayout>;
};

TrashPage.getLayout = function getLayout(page) {
  return (
    <>
      <Layout {...page.props}>{page}</Layout>
      <EmptyTrashModalLazyLoaded />
    </>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  return {
    props: {
      serverConfig: {
        isSearchServiceConfigured: searchService.isConfigured,
        isSearchServiceReachable: searchService.isReachable,
        isSearchScopeChildrenAsDefault: configManager.getConfig(
          'customize:isSearchScopeChildrenAsDefault',
        ),
        showPageLimitationXL: crowi.configManager.getConfig(
          'customize:showPageLimitationXL',
        ),
      },
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req: CrowiRequest = context.req as CrowiRequest;

  // redirect to the page the user was on before moving to the Login Page
  if (req.headers.referer != null) {
    const urlBeforeLogin = new URL(req.headers.referer);
    if (
      isPermalink(urlBeforeLogin.pathname) ||
      isUserPage(urlBeforeLogin.pathname) ||
      isUsersTopPage(urlBeforeLogin.pathname)
    ) {
      req.session.redirectTo = urlBeforeLogin.href;
    }
  }

  const [
    commonInitialResult,
    commonEachResult,
    basicLayoutResult,
    serverConfigResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideConfigurationProps(context),
    getServerSideI18nProps(context, ['translation']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(
        basicLayoutResult,
        mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
      ),
    ),
  );
};

export default TrashPage;
