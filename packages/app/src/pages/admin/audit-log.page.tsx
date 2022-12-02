import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';

import { SupportedActionType } from '~/interfaces/activity';
import { CrowiRequest } from '~/interfaces/crowi-request';
import { CommonProps, useCustomTitle } from '~/pages/utils/commons';
import { useCurrentUser, useAuditLogEnabled, useAuditLogAvailableActions } from '~/stores/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });

const AuditLogManagement = dynamic(() => import('~/components/Admin/AuditLogManagement').then(mod => mod.AuditLogManagement), { ssr: false });


type Props = CommonProps & {
  auditLogEnabled: boolean,
  auditLogAvailableActions: SupportedActionType[],
};


const AdminAuditLogPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('admin');
  useAuditLogEnabled(props.auditLogEnabled);
  useAuditLogAvailableActions(props.auditLogAvailableActions);
  useCurrentUser(props.currentUser ?? null);

  const title = t('audit_log_management.audit_log');

  return (
    <AdminLayout title={useCustomTitle(props, title)} componentTitle={title} >
      <AuditLogManagement />
    </AdminLayout>
  );

};

const injectServerConfigurations = async(context: GetServerSidePropsContext, props: Props): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { activityService } = crowi;

  props.auditLogEnabled = crowi.configManager.getConfig('crowi', 'app:auditLogEnabled');
  props.auditLogAvailableActions = activityService.getAvailableActions(false);
};


export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context, injectServerConfigurations);
  return props;
};


export default AdminAuditLogPage;
