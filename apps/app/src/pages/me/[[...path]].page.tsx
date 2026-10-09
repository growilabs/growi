import React, { type JSX, type ReactNode, useMemo } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';

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
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import type { ServerConfigurationProps } from './types';
import { useHydrateServerConfigurationAtoms } from './use-hydrate-server-configurations';

const logger = loggerFactory('growi:pages:me');

const PersonalSettings = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Me/PersonalSettings'),
  { ssr: false },
);
// const MyDraftList = dynamic(() => import('~/components/MyDraftList/MyDraftList'), { ssr: false });
const InAppNotificationPage = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/InAppNotification/InAppNotificationPage').then(
      (mod) => mod.InAppNotificationPage,
    ),
  { ssr: false },
);
// `/me/chat-integration/account-link/:token` (task 6.1's one-time-link
// approval screen) is a MULTI-segment path under this single first-segment
// key -- the component itself reads the remaining segments via
// `useRouter()` (see AccountLinkApproval.tsx), not this dispatcher.
const AccountLinkApproval = dynamic(
  () =>
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/features/chat-integration/client/components/AccountLinkApproval'
    ).then((mod) => mod.AccountLinkApproval),
  { ssr: false },
);

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps &
  ServerConfigurationProps;

const MePage: NextPageWithLayout<Props> = (props: Props) => {
  useHydrateServerConfigurationAtoms(props.serverConfig);

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
      //   title: t('List Drafts'),
      //   component: <MyDraftList />,
      // },
      'all-in-app-notifications': {
        title: t('commons:in_app_notification.notification_list'),
        component: <InAppNotificationPage />,
      },
      'chat-integration': {
        // English-first: no locale key added yet for this screen (see
        // .claude/rules -- i18n is deferred, not a completion gate).
        title: 'Link Chat Account',
        component: <AccountLinkApproval />,
      },
    };
  }, [t]);

  // Dispatch on the FIRST path segment only. `mePagesMap` is keyed one
  // level deep -- a page whose own route needs further segments (e.g.
  // `chat-integration/account-link/:token`) reads the rest itself via
  // `useRouter()` (see AccountLinkApproval.tsx), instead of this dispatcher
  // trying to walk the whole `pagePathKeys` array as a nested-map path.
  // (Previously this used `keys.reduce(...)` over the WHOLE array, which
  // 404ed on any path with more than one segment: after the first
  // successful lookup, the accumulator became `{ title, component }` --
  // not a map -- so the second segment's lookup always missed.)
  const getTargetPageToRender = (
    pagesMap: typeof mePagesMap,
    keys: string[],
  ): { title: string; component: JSX.Element } => {
    const page = (
      pagesMap as Record<string, { title: string; component: JSX.Element }>
    )[keys[0]];
    if (page == null) {
      return {
        title: 'NotFoundPage',
        component: <h2>{t('commons:not_found_page.page_not_exist')}</h2>,
      };
    }
    return page;
  };

  const targetPage = getTargetPageToRender(mePagesMap, pagePathKeys);

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
  useHydrateBasicLayoutConfigurationAtoms(
    props.searchConfig,
    props.sidebarConfig,
    props.userUISettings,
  );

  return <BasicLayout>{children}</BasicLayout>;
};

MePage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      serverConfig: {
        registrationWhitelist: configManager.getConfig(
          'security:registrationWhitelist',
        ),
        showPageLimitationXL: configManager.getConfig(
          'customize:showPageLimitationXL',
        ),
      },
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
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
    getServerSideI18nProps(context, ['translation', 'admin'], {
      preloadAllLang: true,
    }),
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

export default MePage;
