import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { SidebarConfigurationProps } from '../types';

export const getServerSideSidebarConfigProps: GetServerSideProps<
  SidebarConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      sidebarConfig: {
        isSidebarCollapsedMode: configManager.getConfig(
          'customize:isSidebarCollapsedMode',
        ),
        isSidebarClosedAtDockMode: configManager.getConfig(
          'customize:isSidebarClosedAtDockMode',
        ),
      },
    },
  };
};
