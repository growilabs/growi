import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page.js';
import type { AdminCommonProps } from './_shared/index.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared/index.js';

const G2GDataTransferPage = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/G2GDataTransfer.js'),
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
      const AdminAppContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminAppContainer.js')).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> =
  getServerSideAdminCommonProps;

export default DataTransferPage;
