import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props.js';
import type { BasicLayoutConfigurationProps } from '../types.js';
import { getServerSideSearchConfigurationProps } from '~/pages/basic-layout-page/get-server-side-props/search-configurations.js';
import { getServerSideSidebarConfigProps } from '~/pages/basic-layout-page/get-server-side-props/sidebar-configurations.js';
import { getServerSideUserUISettingsProps } from '~/pages/basic-layout-page/get-server-side-props/user-ui-settings.js';

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
