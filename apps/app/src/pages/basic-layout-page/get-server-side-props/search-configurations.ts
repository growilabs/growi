import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { SearchConfigurationProps } from '../types';

export const getServerSideSearchConfigurationProps: GetServerSideProps<
  SearchConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  return {
    props: {
      searchConfig: {
        isSearchServiceConfigured: searchService.isConfigured,
        isSearchServiceReachable: searchService.isReachable,
        isSearchScopeChildrenAsDefault: configManager.getConfig(
          'customize:isSearchScopeChildrenAsDefault',
        ),
      },
    },
  };
};
