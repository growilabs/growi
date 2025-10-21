import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';

import AdminLayout from '~/components/Layout/AdminLayout';
import type { CommonProps } from '~/pages/utils/commons';
import { useIsMaintenanceMode } from '~/stores/maintenanceMode';
import { useCurrentUser } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminNotFoundPage = dynamic(
  () =>
    import('~/client/components/Admin/NotFoundPage').then(
      (mod) => mod.AdminNotFoundPage,
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

const AdminAppPage: NextPage<CommonProps> = (props) => {
  useIsMaintenanceMode(props.isMaintenanceMode);
  useCurrentUser(props.currentUser ?? null);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <AdminLayout>
      <AdminNotFoundPage />
    </AdminLayout>
  );
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const props = await retrieveServerSideProps(context);
  return props;
};

export default AdminAppPage;
