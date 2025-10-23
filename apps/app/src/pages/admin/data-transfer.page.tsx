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

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import { useCurrentUser, useGrowiCloudUri } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const G2GDataTransferPage = dynamic(
  () => import('~/client/components/Admin/G2GDataTransfer'),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);

type Props = CommonProps;

const DataTransferPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('commons');
  useCurrentUser(props.currentUser ?? null);
  useGrowiCloudUri(props.growiCloudUri);

  const title = t('g2g_data_transfer.data_transfer');

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
          <title>{title}</title>
        </Head>
        <G2GDataTransferPage />
      </AdminLayout>
    </Provider>
  );
};

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;

  props.growiCloudUri =
    await crowi.configManager.getConfig('app:growiCloudUri');
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

export default DataTransferPage;
