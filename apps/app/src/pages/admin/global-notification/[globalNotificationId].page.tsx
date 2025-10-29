import { useEffect, useMemo } from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { objectIdUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import type { Container } from 'unstated';
import { Provider } from 'unstated';

import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import { useCurrentUser } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const ManageGlobalNotification = dynamic(
  () =>
    import('~/client/components/Admin/Notification/ManageGlobalNotification'),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);

const AdminGlobalNotificationNewPage: NextPage<CommonProps> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);
  const router = useRouter();
  const { globalNotificationId } = router.query;
  const currentGlobalNotificationId = Array.isArray(globalNotificationId)
    ? globalNotificationId[0]
    : globalNotificationId;

  useEffect(() => {
    const toastError = import('~/client/util/toastr').then(
      (mod) => mod.toastError,
    );

    if (globalNotificationId == null) {
      router.push('/admin/notification');
    }
    if (
      currentGlobalNotificationId != null &&
      !objectIdUtils.isValidObjectId(currentGlobalNotificationId)
    ) {
      (async () => {
        (await toastError)(
          t('notification_settings.not_found_global_notification_triggerid'),
        );
        router.push('/admin/global-notification/new');
      })();
      return;
    }
  }, [currentGlobalNotificationId, globalNotificationId, router, t]);

  const title = t('external_notification.external_notification');
  const customTitle = generateCustomTitle(props, title);

  const injectableContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async () => {
      const AdminNotificationContainer = (
        await import('~/client/services/AdminNotificationContainer')
      ).default;
      const adminNotificationContainer = new AdminNotificationContainer();
      injectableContainers.push(adminNotificationContainer);
    })();
  }, [injectableContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    <ForbiddenPage />;
  }

  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout componentTitle={title}>
        <Head>
          <title>{customTitle}</title>
        </Head>
        {currentGlobalNotificationId != null && router.isReady && (
          <ManageGlobalNotification
            globalNotificationId={currentGlobalNotificationId}
          />
        )}
      </AdminLayout>
    </Provider>
  );
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const props = await retrieveServerSideProps(context);
  return props;
};

export default AdminGlobalNotificationNewPage;
