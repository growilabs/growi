import { useEffect } from 'react';

import type { NextPage } from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript';
import { useIsSearchPage } from '~/states/context';

import { getServerSideSearchPageProps } from '../_search/get-server-side-props';
import type { ServerConfigurationProps } from '../_search/types';
import { useHydrateServerConfigurationAtoms } from '../_search/use-hydrate-server-configurations';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate';
import type { CommonEachProps, CommonInitialProps } from '../common-props';
import type { RendererConfigProps } from '../general-page';
import { useCustomTitle } from '../utils/page-title-customization';


const SearchResultLayout = dynamic(() => import('~/components/Layout/SearchResultLayout'), { ssr: false });


type Props = CommonInitialProps & CommonEachProps & BasicLayoutConfigurationProps & ServerConfigurationProps & RendererConfigProps;

const PrivateLegacyPage: NextPage<Props> = (props: Props) => {
  const router = useRouter();
  const { t } = useTranslation();

  const PrivateLegacyPages = dynamic(() => import('~/client/components/PrivateLegacyPages'), { ssr: false });

  // clear the cache for the current page
  //  in order to fix https://redmine.weseek.co.jp/issues/135811
  // useHydratePageAtoms(undefined);
  // useCurrentPathname('/_private-legacy-pages');

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

  const title = useCustomTitle(t('private_legacy_pages.title'));

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

export const getServerSideProps = getServerSideSearchPageProps;

export default PrivateLegacyPage;
