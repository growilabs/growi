import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const DataImportPageContents = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/ImportData/ImportDataPageContents'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminDataImportPage: NextPageWithLayout<Props> = () => (
  <DataImportPageContents />
);

AdminDataImportPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('importer_management.import_data'),
  containerFactories: [
    async () => {
      const AdminImportContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminImportContainer')).default;
      return new AdminImportContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminDataImportPage;
