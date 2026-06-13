import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request.js';

import type { SidebarConfigurationProps } from '../types.js';

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
      },
    },
  };
};
