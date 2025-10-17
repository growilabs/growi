import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AdminNotFoundPage = dynamic(
  () =>
    import('~/client/components/Admin/NotFoundPage').then(
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
