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
import { useCurrentUser } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const LegacySlackIntegration = dynamic(
  () =>
    import(
      '~/client/components/Admin/LegacySlackIntegration/LegacySlackIntegration'
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

const AdminLegacySlackIntegrationPage: NextPage<CommonProps> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);

  const title = t('slack_integration_legacy.slack_integration_legacy');
  const headTitle = generateCustomTitle(props, title);

  const injectableContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async () => {
      const AdminSlackIntegrationLegacyContainer = (
        await import('~/client/services/AdminSlackIntegrationLegacyContainer')
      ).default;
      const adminSlackIntegrationLegacyContainer =
        new AdminSlackIntegrationLegacyContainer();
      injectableContainers.push(adminSlackIntegrationLegacyContainer);
    })();
  }, [injectableContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout componentTitle={title}>
        <Head>
          <title>{headTitle}</title>
        </Head>
        <LegacySlackIntegration />
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

export default AdminLegacySlackIntegrationPage;
