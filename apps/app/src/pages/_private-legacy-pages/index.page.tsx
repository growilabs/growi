import { useEffect } from 'react';
import type { NextPage } from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';

import { DrawioViewerScript } from '~/components/Script/DrawioViewerScript/index.js';
import { useSetSearchPage } from '~/states/context.js';

import { getServerSideSearchPageProps } from '../_search/get-server-side-props/index.js';
import type { ServerConfigurationProps } from '../_search/types.js';
import { useHydrateServerConfigurationAtoms } from '../_search/use-hydrate-server-configurations.js';
import type { BasicLayoutConfigurationProps } from '../basic-layout-page/index.js';
import { useHydrateBasicLayoutConfigurationAtoms } from '../basic-layout-page/hydrate.js';
import type { CommonEachProps, CommonInitialProps } from '../common-props/index.js';
import type { RendererConfigProps } from '../general-page/index.js';
import { useCustomTitle } from '../utils/page-title-customization.js';

const SearchResultLayout = dynamic(
  () => import('~/components/Layout/SearchResultLayout.js'),
  { ssr: false },
);

const PrivateLegacyPages = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/features/search/client/components/PrivateLegacyPages.js'),
  { ssr: false },
);

type Props = CommonInitialProps &
  CommonEachProps &
  BasicLayoutConfigurationProps &
  ServerConfigurationProps &
  RendererConfigProps;

const PrivateLegacyPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  // Hydrate server-side data
  useHydrateBasicLayoutConfigurationAtoms(
    props.searchConfig,
    props.sidebarConfig,
    props.userUISettings,
  );
  useHydrateServerConfigurationAtoms(props.serverConfig, props.rendererConfig);

  const setSearchPage = useSetSearchPage();

  // Turn on search page flag
  useEffect(() => {
    setSearchPage(true);
    // cleanup
    return () => setSearchPage(false);
  }, [setSearchPage]);

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
