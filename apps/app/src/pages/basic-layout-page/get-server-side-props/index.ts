import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import { getServerSideSearchConfigurationProps } from '~/pages/basic-layout-page/get-server-side-props/search-configurations';
import { getServerSideSidebarConfigProps } from '~/pages/basic-layout-page/get-server-side-props/sidebar-configurations';
import { getServerSideUserUISettingsProps } from '~/pages/basic-layout-page/get-server-side-props/user-ui-settings';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props';

import type { BasicLayoutConfigurationProps } from '../types';

export const getServerSideBasicLayoutProps: GetServerSideProps<
  BasicLayoutConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const [searchConfigResult, sidebarConfigResult, userUIResult] =
    await Promise.all([
      getServerSideSearchConfigurationProps(context),
      getServerSideSidebarConfigProps(context),
      getServerSideUserUISettingsProps(context),
    ]);

  return mergeGetServerSidePropsResults(
    searchConfigResult,
    mergeGetServerSidePropsResults(sidebarConfigResult, userUIResult),
  );
};
