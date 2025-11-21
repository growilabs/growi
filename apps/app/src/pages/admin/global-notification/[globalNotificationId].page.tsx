import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { objectIdUtils } from '@growi/core/dist/utils';

import type { NextPageWithLayout } from '../../_app.page';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const ManageGlobalNotification = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/Notification/ManageGlobalNotification'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminGlobalNotificationDetailPage: NextPageWithLayout<Props> = () => {
  const router = useRouter();
  const { globalNotificationId } = router.query;
  const currentGlobalNotificationId = Array.isArray(globalNotificationId)
    ? globalNotificationId[0]
    : globalNotificationId;

  useEffect(() => {
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    const toastErrorPromise = import('~/client/util/toastr').then(
      (mod) => mod.toastError,
    );
    if (globalNotificationId == null) {
      router.push('/admin/notification');
      return;
    }
    if (
      currentGlobalNotificationId != null &&
      !objectIdUtils.isValidObjectId(currentGlobalNotificationId)
    ) {
      (async () => {
        (await toastErrorPromise)('Invalid notification id');
        router.push('/admin/global-notification/new');
      })();
    }
  }, [currentGlobalNotificationId, globalNotificationId, router]);

  return currentGlobalNotificationId != null && router.isReady ? (
    <ManageGlobalNotification
      globalNotificationId={currentGlobalNotificationId}
    />
  ) : null;
};

AdminGlobalNotificationDetailPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('external_notification.external_notification'),
  containerFactories: [
    async () => {
      const AdminNotificationContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminNotificationContainer')).default;
      return new AdminNotificationContainer();
    },
  ],
});

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminGlobalNotificationDetailPage;
