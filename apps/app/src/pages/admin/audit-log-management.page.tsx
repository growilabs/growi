import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  auditLogEnabledAtom,
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

const AuditLogIndexManagement = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/AuditLogIndexManagement').then(
      (mod) => mod.AuditLogIndexManagement,
    ),
  { ssr: false },
);

type PageProps = {
  auditLogEnabled: boolean;
};

type Props = AdminCommonProps & SearchConfigurationProps & PageProps;

const AdminAuditLogIndexManagementPage: NextPageWithLayout<Props> = (
  props: Props,
) => {
  useHydrateAtoms(
    [
      [auditLogEnabledAtom, props.auditLogEnabled],
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

  return <AuditLogIndexManagement />;
};

AdminAuditLogIndexManagementPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('audit_log_index_management.audit_log_index_management'),
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const baseResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  const auditLogPropsFragment = {
    props: {
      auditLogEnabled: configManager.getConfig('app:auditLogEnabled'),
    },
  } satisfies { props: PageProps };

  return mergeGetServerSidePropsResults(
    mergeGetServerSidePropsResults(baseResult, auditLogPropsFragment),
    await getServerSideSearchConfigurationProps(context),
  );
};

export default AdminAuditLogIndexManagementPage;
