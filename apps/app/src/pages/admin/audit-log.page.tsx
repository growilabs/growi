import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';

import type { SupportedActionType } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import {
  useActivityExpirationSeconds,
  useAuditLogAvailableActions,
  useAuditLogEnabled,
  useCurrentUser,
} from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const AuditLogManagement = dynamic(
  () =>
    import('~/client/components/Admin/AuditLogManagement').then(
      (mod) => mod.AuditLogManagement,
    ),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);

type Props = CommonProps & {
  auditLogEnabled: boolean;
  activityExpirationSeconds: number;
  auditLogAvailableActions: SupportedActionType[];
};

const AdminAuditLogPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('admin');
  useAuditLogEnabled(props.auditLogEnabled);
  useActivityExpirationSeconds(props.activityExpirationSeconds);
  useAuditLogAvailableActions(props.auditLogAvailableActions);
  useCurrentUser(props.currentUser ?? null);

  const title = t('audit_log_management.audit_log');
  const headTitle = generateCustomTitle(props, title);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <AdminLayout componentTitle={title}>
      <Head>
        <title>{headTitle}</title>
      </Head>
      <AuditLogManagement />
    </AdminLayout>
  );
};

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { activityService } = crowi;

  props.auditLogEnabled = crowi.configManager.getConfig('app:auditLogEnabled');
  props.activityExpirationSeconds = crowi.configManager.getConfig(
    'app:activityExpirationSeconds',
  );
  props.auditLogAvailableActions = activityService.getAvailableActions(false);
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const props = await retrieveServerSideProps(
    context,
    injectServerConfigurations,
  );
  return props;
};

export default AdminAuditLogPage;
