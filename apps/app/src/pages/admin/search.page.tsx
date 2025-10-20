import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import {
  isSearchScopeChildrenAsDefaultAtom,
  isSearchServiceConfiguredAtom,
  isSearchServiceReachableAtom,
} from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import type { SearchConfigurationProps } from '../basic-layout-page';
import { getServerSideSearchConfigurationProps } from '../basic-layout-page/get-server-side-props/search-configurations';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const FullTextSearchManagement = dynamic(
  () =>
    import('~/client/components/Admin/FullTextSearchManagement').then(
      (mod) => mod.FullTextSearchManagement,
    ),
  { ssr: false },
);

type Props = AdminCommonProps & SearchConfigurationProps;

const AdminFullTextSearchManagementPage: NextPageWithLayout<Props> = (
  props: Props,
) => {
  // hydrate
  useHydrateAtoms(
    [
      [
        isSearchServiceConfiguredAtom,
        props.searchConfig.isSearchServiceConfigured,
      ],
      [
        isSearchServiceReachableAtom,
        props.searchConfig.isSearchServiceReachable,
      ],
      [
        isSearchScopeChildrenAsDefaultAtom,
        props.searchConfig.isSearchScopeChildrenAsDefault,
      ],
    ],
    { dangerouslyForceHydrate: true },
  );

  return <FullTextSearchManagement />;
};

AdminFullTextSearchManagementPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) =>
    t('full_text_search_management.full_text_search_management'),
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  return mergeGetServerSidePropsResults(
    await getServerSideAdminCommonProps(context),
    await getServerSideSearchConfigurationProps(context),
  );
};

export default AdminFullTextSearchManagementPage;
