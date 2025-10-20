import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../../_app.page';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const ManageGlobalNotification = dynamic(
  () =>
    import('~/client/components/Admin/Notification/ManageGlobalNotification'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminGlobalNotificationNewPage: NextPageWithLayout<Props> = () => (
  <ManageGlobalNotification />
);

AdminGlobalNotificationNewPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('external_notification.external_notification'),
  containerFactories: [
    async () => {
      const AdminNotificationContainer = (
        await import('~/client/services/AdminNotificationContainer')
      ).default;
      return new AdminNotificationContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> =
  getServerSideAdminCommonProps;

export default AdminGlobalNotificationNewPage;
