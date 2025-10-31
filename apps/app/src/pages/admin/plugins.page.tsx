import { useEffect, useMemo } from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import type { Container } from 'unstated';
import { Provider } from 'unstated';

import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import { useIsMaintenanceMode } from '~/stores/maintenanceMode';
import { useCurrentUser } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const PluginsExtensionPageContents = dynamic(
  () =>
    import('~/features/growi-plugin/client/components/Admin').then(
      (mod) => mod.PluginsExtensionPageContents,
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
  const { t } = useTranslation('admin');
  useIsMaintenanceMode(props.isMaintenanceMode);
  useCurrentUser(props.currentUser ?? null);

  const title = t('plugins.plugins');

  const injectableContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async () => {
      const AdminAppContainer = (
        await import('~/client/services/AdminAppContainer')
      ).default;
      const adminAppContainer = new AdminAppContainer();
      injectableContainers.push(adminAppContainer);
    })();
  }, [injectableContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout componentTitle={title}>
        <Head>
          <title>{generateCustomTitle(props, title)}</title>
        </Head>
        <PluginsExtensionPageContents />
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

export default AdminAppPage;
