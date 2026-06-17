import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import type { BasicLayoutConfigurationProps } from '../types';
import { getServerSideAiConfigProps } from './ai-configurations';
import { getServerSideSearchConfigurationProps } from './search-configurations';
import { getServerSideSidebarConfigProps } from './sidebar-configurations';
import { getServerSideUserUISettingsProps } from './user-ui-settings';

export const getServerSideBasicLayoutProps: GetServerSideProps<
  BasicLayoutConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const [
    searchConfigResult,
    sidebarConfigResult,
    userUIResult,
    aiConfigResult,
  ] = await Promise.all([
    getServerSideSearchConfigurationProps(context),
    getServerSideSidebarConfigProps(context),
    getServerSideUserUISettingsProps(context),
    getServerSideAiConfigProps(context),
  ]);

  return mergeGetServerSidePropsResults(
    searchConfigResult,
    mergeGetServerSidePropsResults(
      sidebarConfigResult,
      mergeGetServerSidePropsResults(userUIResult, aiConfigResult),
    ),
  );
};
