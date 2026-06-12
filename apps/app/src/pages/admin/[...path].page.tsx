import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared/index.js';

const AdminNotFoundPage = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/NotFoundPage.js').then(
      (mod) => mod.AdminNotFoundPage,
    ),
  { ssr: false },
);

const AdminCatchAllPage: NextPageWithLayout = () => <AdminNotFoundPage />;

AdminCatchAllPage.getLayout = createAdminPageLayout({
  title: () => 'Not Found',
});

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminCatchAllPage;
