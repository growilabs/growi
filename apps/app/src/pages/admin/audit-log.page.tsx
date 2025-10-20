import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { SupportedActionType } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  activityExpirationSecondsAtom,
  auditLogAvailableActionsAtom,
  auditLogEnabledAtom,
} from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AuditLogManagement = dynamic(
  () =>
    import('~/client/components/Admin/AuditLogManagement').then(
      (mod) => mod.AuditLogManagement,
    ),
  { ssr: false },
);

type PageProps = {
  auditLogEnabled: boolean;
  activityExpirationSeconds: number;
  auditLogAvailableActions: SupportedActionType[];
};

type Props = AdminCommonProps & PageProps;

const AdminAuditLogPage: NextPageWithLayout<Props> = (props: Props) => {
  // hydrate
  useHydrateAtoms(
    [
      [auditLogEnabledAtom, props.auditLogEnabled],
      [activityExpirationSecondsAtom, props.activityExpirationSeconds],
      [auditLogAvailableActionsAtom, props.auditLogAvailableActions],
    ],
    { dangerouslyForceHydrate: true },
  );

  return <AuditLogManagement />;
};

// No extra containers required presently; values injected directly via props + existing universal stores inside component children
AdminAuditLogPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('audit_log_management.audit_log'),
});

// Extend common SSR to inject audit log specific server configs
export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const baseResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, activityService } = crowi;

  // Build audit-log specific result fragment
  const auditLogPropsFragment = {
    props: {
      auditLogEnabled: configManager.getConfig('app:auditLogEnabled'),
      activityExpirationSeconds: configManager.getConfig(
        'app:activityExpirationSeconds',
      ),
      auditLogAvailableActions: activityService.getAvailableActions(false),
    },
  } satisfies { props: PageProps };

  return mergeGetServerSidePropsResults(baseResult, auditLogPropsFragment);
};

export default AdminAuditLogPage;
