import type { GetServerSideProps, GetServerSidePropsContext } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { SearchConfigurationProps } from '../types';

export const getServerSideSearchConfigurationProps: GetServerSideProps<
  SearchConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, searchService } = crowi;

  const extractorUri = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorUri',
  );
  const extractorToken = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorToken',
  );

  // Compute the boolean flag without leaking secret values into SSR props.
  // extractorToken is write-only; only the derived boolean is exposed.
  const isAttachmentFullTextSearchEnabled =
    searchService.isConfigured &&
    extractorUri != null &&
    extractorUri !== '' &&
    extractorToken != null &&
    extractorToken !== '';

  return {
    props: {
      searchConfig: {
        isSearchServiceConfigured: searchService.isConfigured,
        isSearchServiceReachable: searchService.isReachable,
        isSearchScopeChildrenAsDefault: configManager.getConfig(
          'customize:isSearchScopeChildrenAsDefault',
        ),
        isAttachmentFullTextSearchEnabled,
      },
    },
  };
};
