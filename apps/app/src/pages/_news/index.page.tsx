import type { JSX, ReactNode } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import { BasicLayout } from '~/components/Layout/BasicLayout';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar';

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
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

const NewsFeed = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/news/client/components/NewsFeed').then(
      (m) => m.NewsFeed,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted text-center">
        <LoadingSpinner className="mt-3 fs-3" />
      </div>
    ),
  },
);

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps;

const NewsFeedPage: NextPageWithLayout<Props> = () => {
  const { t } = useTranslation('commons');
  const title = useCustomTitle(t('in_app_notification.news'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="dynamic-layout-root">
        <GroundGlassBar className="sticky-top py-4"></GroundGlassBar>

        <div className="main ps-sidebar" data-testid="news-feed-page">
          <div className="container-lg wide-gutter-x-lg">
            <h2 className="sticky-top py-1">{t('in_app_notification.news')}</h2>

            <NewsFeed />
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

NewsFeedPage.getLayout = function getLayout(page) {
  return <Layout {...page.props}>{page}</Layout>;
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [
    commonInitialResult,
    commonEachResult,
    basicLayoutResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideBasicLayoutProps(context),
    getServerSideI18nProps(context, ['translation', 'commons']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(basicLayoutResult, i18nPropsResult),
    ),
  );
};

export default NewsFeedPage;
