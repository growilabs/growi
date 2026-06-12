import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../../_app.page.js';
import type { AdminCommonProps } from '../_shared/index.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared/index.js';

const ManageGlobalNotification = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/Notification/ManageGlobalNotification.js'),
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
      const AdminNotificationContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminNotificationContainer.js')).default;
      return new AdminNotificationContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> =
  getServerSideAdminCommonProps;

export default AdminGlobalNotificationNewPage;
