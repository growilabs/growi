import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { IUser } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { RendererConfig } from '~/interfaces/services/renderer';
import type { ISidebarConfig } from '~/interfaces/sidebar-config';
import { useCurrentPageId, useSWRxCurrentPage } from '~/stores/page';
import {
  useCsrfToken,
  useCurrentPathname,
  useCurrentUser,
  useGrowiCloudUri,
  useIsEnabledMarp,
  useIsSearchPage,
  useIsSearchScopeChildrenAsDefault,
  useIsSearchServiceConfigured,
  useIsSearchServiceReachable,
  useRendererConfig,
} from '~/stores-universal/context';

import type { CommonProps } from './utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
  useInitSidebarConfig,
} from './utils/commons';

const SearchResultLayout = dynamic(
  () => import('~/components/Layout/SearchResultLayout'),
  { ssr: false },
);

type Props = CommonProps & {
  currentUser: IUser;

  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;
  isEnabledMarp: boolean;

  // Render config
  rendererConfig: RendererConfig;

  sidebarConfig: ISidebarConfig;
};

const PrivateLegacyPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  const PrivateLegacyPages = dynamic(
    () => import('~/client/components/PrivateLegacyPages'),
    { ssr: false },
  );

  // commons
  useCsrfToken(props.csrfToken);
  useGrowiCloudUri(props.growiCloudUri);

  useCurrentUser(props.currentUser ?? null);

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  useSWRxCurrentPage(null);
  useCurrentPageId(null);
  useCurrentPathname('/_private-legacy-pages');

  // Search
  useIsSearchPage(true);
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);
  useIsEnabledMarp(props.isEnabledMarp);

  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  // render config
  useRendererConfig(props.rendererConfig);

  const title = generateCustomTitle(props, t('private_legacy_pages.title'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      <DrawioViewerScript drawioUri={props.rendererConfig.drawioUri} />

      <SearchResultLayout>
        <div id="private-regacy-pages">
          <PrivateLegacyPages />
        </div>
      </SearchResultLayout>
    </>
  );
};

async function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );
  props.isEnabledMarp = configManager.getConfig('customize:isEnabledMarp');

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

  await injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default PrivateLegacyPage;
