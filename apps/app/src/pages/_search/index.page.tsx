import { useEffect } from 'react';

import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { useIsSearchPage } from '~/states/context';

import type { NextPageWithLayout } from '../_app.page';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import type { RendererConfigProps } from '../general-page';
import { useCustomTitle } from '../utils/page-title-customization';

import { getServerSideSearchPageProps } from './get-server-side-props';
import type { ServerConfigurationProps } from './types';
import { useHydrateServerConfigurationAtoms } from './use-hydrate-server-configurations';


const SearchResultLayout = dynamic(() => import('~/components/Layout/SearchResultLayout'), { ssr: false });
const SearchPage = dynamic(() => import('~/client/components/SearchPage').then(mod => mod.SearchPage), { ssr: false });

type Props = CommonInitialProps & CommonEachProps & BasicLayoutConfigurationProps & ServerConfigurationProps & RendererConfigProps;

const SearchResultPage: NextPageWithLayout<Props> = (props: Props) => {
  const router = useRouter();
  const { t } = useTranslation();

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  // useHydratePageAtoms(undefined);
  // useCurrentPathname('/_search');

  // const [, setSearchPage] = useIsSearchPage();

  // Hydrate server-side data
  useHydrateBasicLayoutConfigurationAtoms(props.searchConfig, props.sidebarConfig, props.userUISettings);
  useHydrateServerConfigurationAtoms(props.serverConfig, props.rendererConfig);

  const [, setIsSearchPage] = useIsSearchPage();

  // Turn on search page flag
  useEffect(() => {
    setIsSearchPage(true);
    // cleanup
    return () => setIsSearchPage(false);
  }, [router, setIsSearchPage]);

  const title = useCustomTitle(t('search_result.title'));

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>

      <DrawioViewerScript drawioUri={props.rendererConfig.drawioUri} />

      <SearchResultLayout>
        <SearchPage />
      </SearchResultLayout>
    </>
  );
};

export const getServerSideProps = getServerSideSearchPageProps;

export default SearchResultPage;
