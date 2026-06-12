import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import { mergeGetServerSidePropsResults } from '../../utils/server-side-props.js';
import type { BasicLayoutConfigurationProps } from '../types.js';
import { getServerSideSearchConfigurationProps } from './search-configurations.js';
import { getServerSideSidebarConfigProps } from './sidebar-configurations.js';
import { getServerSideUserUISettingsProps } from './user-ui-settings.js';

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
