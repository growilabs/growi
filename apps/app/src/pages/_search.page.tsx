import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { IUser } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import SearchResultLayout from '~/components/Layout/SearchResultLayout';
import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import { useCurrentPageId, useSWRxCurrentPage } from '~/stores/page';
import {
  useCurrentPathname,
  useCurrentUser,
  useGrowiCloudUri,
  useIsContainerFluid,
  useIsSearchPage,
  useIsSearchScopeChildrenAsDefault,
  useIsSearchServiceConfigured,
  useIsSearchServiceReachable,
  useRendererConfig,
  useShowPageLimitationL,
} from '~/stores-universal/context';

import type { NextPageWithLayout } from './_app.page';
import type { CommonProps } from './utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
  useInitSidebarConfig,
} from './utils/commons';

const SearchPage = dynamic(
  () => import('~/client/components/SearchPage').then((mod) => mod.SearchPage),
  { ssr: false },
);

type Props = CommonProps & {
  currentUser: IUser;

  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;

  // Render config
  rendererConfig: RendererConfig;

  // search limit
  showPageLimitationL: number;

  isContainerFluid: boolean;

  sidebarConfig: ISidebarConfig;
};

const SearchResultPage: NextPageWithLayout<Props> = (props: Props) => {
  const { t } = useTranslation();

  // commons
  useGrowiCloudUri(props.growiCloudUri);

  useCurrentUser(props.currentUser ?? null);

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  useSWRxCurrentPage(null);
  useCurrentPageId(null);
  useCurrentPathname('/_search');

  // Search
  useIsSearchPage(true);
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  // render config
  useRendererConfig(props.rendererConfig);

  useShowPageLimitationL(props.showPageLimitationL);
  useIsContainerFluid(props.isContainerFluid);

  const title = generateCustomTitle(props, t('search_result.title'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      <SearchPage />
    </>
  );
};

type LayoutProps = Props & {
  sidebarConfig: ISidebarConfig;
  children?: ReactNode;
};

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  return <SearchResultLayout>{children}</SearchResultLayout>;
};

SearchResultPage.getLayout = function getLayout(page) {
  return (
    <>
      <DrawioViewerScript drawioUri={page.props.rendererConfig.drawioUri} />
      <Layout {...page.props}>{page}</Layout>
    </>
  );
};

function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): void {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );
  props.isContainerFluid = configManager.getConfig(
    'customize:isContainerFluid',
  );

  props.sidebarConfig = {
    isSidebarCollapsedMode: configManager.getConfig(
      'customize:isSidebarCollapsedMode',
    ),
    isSidebarClosedAtDockMode: configManager.getConfig(
      'customize:isSidebarClosedAtDockMode',
    ),
  };

  props.rendererConfig = {
    isEnabledLinebreaks: configManager.getConfig(
      'markdown:isEnabledLinebreaks',
    ),
    isEnabledLinebreaksInComments: configManager.getConfig(
      'markdown:isEnabledLinebreaksInComments',
    ),
    isEnabledMarp: configManager.getConfig('customize:isEnabledMarp'),
    adminPreferredIndentSize: configManager.getConfig(
      'markdown:adminPreferredIndentSize',
    ),
    isIndentSizeForced: configManager.getConfig('markdown:isIndentSizeForced'),

    drawioUri: configManager.getConfig('app:drawioUri'),
    plantumlUri: configManager.getConfig('app:plantumlUri'),

    // XSS Options
    isEnabledXssPrevention: configManager.getConfig(
      'markdown:rehypeSanitize:isEnabledPrevention',
    ),
    sanitizeType: configManager.getConfig('markdown:rehypeSanitize:option'),
    customTagWhitelist: crowi.configManager.getConfig(
      'markdown:rehypeSanitize:tagNames',
    ),
    customAttrWhitelist:
      configManager.getConfig('markdown:rehypeSanitize:attributes') != null
        ? JSON.parse(
            configManager.getConfig('markdown:rehypeSanitize:attributes'),
          )
        : undefined,
    highlightJsStyleBorder: crowi.configManager.getConfig(
      'customize:highlightJsStyleBorder',
    ),
  };

  props.showPageLimitationL = configManager.getConfig(
    'customize:showPageLimitationL',
  );
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

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
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

export default SearchResultPage;
