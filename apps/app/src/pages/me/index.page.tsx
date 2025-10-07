import React, { type ReactNode, useMemo, type JSX } from 'react';

import type {
  GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { BasicLayoutConfigurationProps } from '~/pages/basic-layout-page';
import { getServerSideBasicLayoutProps } from '~/pages/basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '~/pages/basic-layout-page/hydrate';
import { useCustomTitle } from '~/pages/utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props';
import loggerFactory from '~/utils/logger';

import type { NextPageWithLayout } from '../_app.page';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps, getServerSideCommonInitialProps, getServerSideI18nProps,
} from '../common-props';

import type { ServerConfigurationProps } from './types';
import { useHydrateServerConfigurationAtoms } from './use-hydrate-server-configurations';


const logger = loggerFactory('growi:pages:me');


const PersonalSettings = dynamic(() => import('~/client/components/Me/PersonalSettings'), { ssr: false });
// const MyDraftList = dynamic(() => import('~/components/MyDraftList/MyDraftList'), { ssr: false });
const InAppNotificationPage = dynamic(
  () => import('~/client/components/InAppNotification/InAppNotificationPage').then(mod => mod.InAppNotificationPage), { ssr: false },
);


type Props = CommonInitialProps & CommonEachProps & BasicLayoutConfigurationProps & ServerConfigurationProps;

const MePage: NextPageWithLayout<Props> = (props: Props) => {
  useHydrateServerConfigurationAtoms(props.serverConfig);

  const router = useRouter();
  const { t } = useTranslation(['translation', 'commons']);
  const { path } = router.query;
  const pagePathKeys: string[] = Array.isArray(path) ? path : ['personal-settings'];

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

  const getTargetPageToRender = (pagesMap, keys): {title: string, component: JSX.Element} => {
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

  // // clear the cache for the current page
  // //  in order to fix https://redmine.weseek.co.jp/issues/135811
  // useHydratePageAtoms(undefined);
  // useCurrentPathname('/me');

  const title = useCustomTitle(targetPage.title);

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar">
          <div className="container-lg wide-gutter-x-lg">

            <h1 className="sticky-top py-2 fs-3">{ targetPage.title }</h1>

            {targetPage.component}

          </div>
        </div>
      </div>
    </>
  );
};


type LayoutProps = Props & {
  children?: ReactNode
}

const Layout = ({ children, ...props }: LayoutProps): JSX.Element => {
  useHydrateBasicLayoutConfigurationAtoms(props.searchConfig, props.sidebarConfig, props.userUISettings);

  return (
    <BasicLayout>
      {children}
    </BasicLayout>
  );
};

MePage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

const getServerSideConfigurationProps: GetServerSideProps<ServerConfigurationProps> = async(context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      serverConfig: {
        registrationWhitelist: configManager.getConfig('security:registrationWhitelist'),
        showPageLimitationXL: configManager.getConfig('customize:showPageLimitationXL'),
      },
    },
  };
};

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
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
    getServerSideI18nProps(context, ['translation', 'admin'], { preloadAllLang: true }),
  ]);

  return mergeGetServerSidePropsResults(commonInitialResult,
    mergeGetServerSidePropsResults(commonEachResult,
      mergeGetServerSidePropsResults(basicLayoutResult,
        mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult))));
};

export default MePage;
