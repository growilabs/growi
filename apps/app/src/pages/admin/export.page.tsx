import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const ExportArchiveDataPage = dynamic(
  () => import('~/client/components/Admin/ExportArchiveDataPage'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminExportDataArchivePage: NextPageWithLayout<Props> = () => (
  <ExportArchiveDataPage />
);

AdminExportDataArchivePage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('export_management.export_archive_data'),
  containerFactories: [
    async () => {
      const AdminAppContainer = (
        await import('~/client/services/AdminAppContainer')
      ).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminExportDataArchivePage;
