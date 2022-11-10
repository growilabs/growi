import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';

import { CrowiRequest } from '~/interfaces/crowi-request';
import { CommonProps, useCustomTitle } from '~/pages/utils/commons';
import { useIsAclEnabled } from '~/stores/context';
import { useIsMaintenanceMode } from '~/stores/maintenanceMode';

import { retrieveServerSideProps } from '../../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });
const UserGroupDetailPage = dynamic(() => import('~/components/Admin/UserGroupDetail/UserGroupDetailPage'), { ssr: false });

type Props = CommonProps & {
  isAclEnabled: boolean
}

const AdminUserGroupDetailPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation('admin');
  useIsMaintenanceMode(props.isMaintenanceMode);
  const router = useRouter();
  const { userGroupId } = router.query;

  const title = t('user_group_management.user_group_management');
  const customTitle = useCustomTitle(props, title);

  const currentUserGroupId = Array.isArray(userGroupId) ? userGroupId[0] : userGroupId;

  useIsAclEnabled(props.isAclEnabled);

  return (
    <AdminLayout title={customTitle} componentTitle={title} >
      {
        currentUserGroupId != null && router.isReady
      && <UserGroupDetailPage userGroupId={currentUserGroupId} />
      }
    </AdminLayout>
  );
};

const injectServerConfigurations = async(context: GetServerSidePropsContext, props: Props): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  props.isAclEnabled = req.crowi.aclService.isAclEnabled();
};

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context, injectServerConfigurations);

  return props;
};

export default AdminUserGroupDetailPage;
