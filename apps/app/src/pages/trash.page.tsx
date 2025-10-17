import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { IUser } from '@growi/core';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { PagePathNavTitle } from '~/components/Common/PagePathNavTitle';
import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import { useCurrentPageId, useSWRxCurrentPage } from '~/stores/page';
import {
  useCurrentPathname,
  useCurrentUser,
  useGrowiCloudUri,
  useIsSearchPage,
  useIsSearchScopeChildrenAsDefault,
  useIsSearchServiceConfigured,
  useIsSearchServiceReachable,
  useShowPageLimitationXL,
} from '~/stores-universal/context';

import type { NextPageWithLayout } from './_app.page';
import type { CommonProps } from './utils/commons';
import {
  generateCustomTitleForPage,
  getNextI18NextConfig,
  getServerSideCommonProps,
  useInitSidebarConfig,
} from './utils/commons';

const TrashPageList = dynamic(
  () =>
    import('~/client/components/TrashPageList').then(
      (mod) => mod.TrashPageList,
    ),
  { ssr: false },
);
const EmptyTrashModal = dynamic(
  () => import('~/client/components/EmptyTrashModal'),
  { ssr: false },
);

type Props = CommonProps & {
  currentUser: IUser;
  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;
  showPageLimitationXL: number;

  rendererConfig: RendererConfig;

  sidebarConfig: ISidebarConfig;
};

const TrashPage: NextPageWithLayout<CommonProps> = (props: Props) => {
  useCurrentUser(props.currentUser ?? null);

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  useSWRxCurrentPage(null);
  useCurrentPageId(null);
  useCurrentPathname('/trash');

  useGrowiCloudUri(props.growiCloudUri);

  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  useIsSearchPage(false);

  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  useShowPageLimitationXL(props.showPageLimitationXL);

  const title = generateCustomTitleForPage(props, '/trash');

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
  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  return <BasicLayout>{children}</BasicLayout>;
};

TrashPage.getLayout = function getLayout(page) {
  return (
    <>
      <Layout {...page.props}>{page}</Layout>
      <EmptyTrashModal />
    </>
  );
};

function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): void {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { searchService, configManager } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );
  props.showPageLimitationXL = crowi.configManager.getConfig(
    'customize:showPageLimitationXL',
  );

  props.sidebarConfig = {
    isSidebarCollapsedMode: configManager.getConfig(
      'customize:isSidebarCollapsedMode',
    ),
    isSidebarClosedAtDockMode: configManager.getConfig(
      'customize:isSidebarClosedAtDockMode',
    ),
  };
}

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req = context.req as CrowiRequest;
  const { user } = req;
  const result = await getServerSideCommonProps(context);

  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }
  const props: Props = result.props as Props;

  if (user != null) {
    props.currentUser = user.toObject();
  }
  injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default TrashPage;
