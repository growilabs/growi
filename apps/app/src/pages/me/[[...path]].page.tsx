import React, { type JSX, type ReactNode, useMemo } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
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
  useRegistrationWhitelist,
  useRendererConfig,
  useShowPageLimitationXL,
} from '~/stores-universal/context';
import loggerFactory from '~/utils/logger';

import type { NextPageWithLayout } from '../_app.page';
import type { CommonProps } from '../utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
  useInitSidebarConfig,
} from '../utils/commons';

const logger = loggerFactory('growi:pages:me');

type Props = CommonProps & {
  isSearchServiceConfigured: boolean;
  isSearchServiceReachable: boolean;
  isSearchScopeChildrenAsDefault: boolean;
  isEnabledMarp: boolean;
  rendererConfig: RendererConfig;
  showPageLimitationXL: number;

  // config
  registrationWhitelist: string[];

  sidebarConfig: ISidebarConfig;
};

const PersonalSettings = dynamic(
  () => import('~/client/components/Me/PersonalSettings'),
  { ssr: false },
);
// const MyDraftList = dynamic(() => import('~/components/MyDraftList/MyDraftList'), { ssr: false });
const InAppNotificationPage = dynamic(
  () =>
    import('~/client/components/InAppNotification/InAppNotificationPage').then(
      (mod) => mod.InAppNotificationPage,
    ),
  { ssr: false },
);

const MePage: NextPageWithLayout<Props> = (props: Props) => {
  const router = useRouter();
  const { t } = useTranslation(['translation', 'commons']);
  const { path } = router.query;
  const pagePathKeys: string[] = Array.isArray(path)
    ? path
    : ['personal-settings'];

  const mePagesMap = useMemo(() => {
    return {
      'personal-settings': {
        title: t('User Settings'),
        component: <PersonalSettings />,
      },
      // drafts: {
      //   title: t('My Drafts'),
      //   component: <MyDraftList />,
      // },
      'all-in-app-notifications': {
        title: t('commons:in_app_notification.notification_list'),
        component: <InAppNotificationPage />,
      },
    };
  }, [t]);

  const getTargetPageToRender = (
    pagesMap,
    keys,
  ): { title: string; component: JSX.Element } => {
    return keys.reduce((pagesMap, key) => {
      const page = pagesMap[key];
      if (page == null) {
        return {
          title: 'NotFoundPage',
          component: <h2>{t('commons:not_found_page.page_not_exist')}</h2>,
        };
      }
      return pagesMap[key];
    }, pagesMap);
  };

  const targetPage = getTargetPageToRender(mePagesMap, pagePathKeys);

  useIsSearchPage(false);

  useRegistrationWhitelist(props.registrationWhitelist);

  useShowPageLimitationXL(props.showPageLimitationXL);

  // commons
  useCsrfToken(props.csrfToken);
  useGrowiCloudUri(props.growiCloudUri);

  useCurrentUser(props.currentUser ?? null);

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  useSWRxCurrentPage(null);
  useCurrentPageId(null);
  useCurrentPathname('/me');

  // init sidebar config with UserUISettings and sidebarConfig
  useInitSidebarConfig(props.sidebarConfig, props.userUISettings);

  // page
  useIsSearchServiceConfigured(props.isSearchServiceConfigured);
  useIsSearchServiceReachable(props.isSearchServiceReachable);
  useIsSearchScopeChildrenAsDefault(props.isSearchScopeChildrenAsDefault);

  useRendererConfig(props.rendererConfig);
  useIsEnabledMarp(props.rendererConfig.isEnabledMarp);

  const title = generateCustomTitle(props, targetPage.title);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar">
          <div className="container-lg wide-gutter-x-lg">
            <h1 className="sticky-top py-2 fs-3">{targetPage.title}</h1>

            {targetPage.component}
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

MePage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

async function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { searchService, configManager } = crowi;

  props.isSearchServiceConfigured = searchService.isConfigured;
  props.isSearchServiceReachable = searchService.isReachable;
  props.isSearchScopeChildrenAsDefault = configManager.getConfig(
    'customize:isSearchScopeChildrenAsDefault',
  );

  props.registrationWhitelist = configManager.getConfig(
    'security:registrationWhitelist',
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

// /**
//  * for Server Side Translations
//  * @param context
//  * @param props
//  * @param namespacesRequired
//  */
async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  // preload all languages because of language lists in user setting
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
    true,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req = context.req as CrowiRequest;
  const { user, crowi } = req;

  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  if (user != null) {
    const User = crowi.model('User');
    const userData = await User.findById(user.id).populate({
      path: 'imageAttachment',
      select: 'filePathProxied',
    });
    props.currentUser = userData.toObject();
  }

  await injectServerConfigurations(context, props);
  await injectNextI18NextConfigurations(context, props, [
    'translation',
    'admin',
    'commons',
  ]);

  return {
    props,
  };
};

export default MePage;
