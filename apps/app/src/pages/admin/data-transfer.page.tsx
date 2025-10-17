import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const G2GDataTransferPage = dynamic(
  () => import('~/client/components/Admin/G2GDataTransfer'),
  { ssr: false },
);

type Props = AdminCommonProps;

const DataTransferPage: NextPageWithLayout<Props> = () => (
  <G2GDataTransferPage />
);

DataTransferPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('g2g_data_transfer.data_transfer', { ns: 'commons' }),
  containerFactories: [
    async () => {
      const AdminAppContainer = (
        await import('~/client/services/AdminAppContainer')
      ).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> =
  getServerSideAdminCommonProps;

export default DataTransferPage;
