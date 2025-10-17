import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../../_app.page';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const ManageExternalAccount = dynamic(
  () => import('~/client/components/Admin/ManageExternalAccount'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminExternalAccountsPage: NextPageWithLayout<Props> = () => (
  <ManageExternalAccount />
);

AdminExternalAccountsPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('user_management.external_account'),
  containerFactories: [
    async () => {
      const AdminExternalAccountsContainer = (
        await import('~/client/services/AdminExternalAccountsContainer')
      ).default;
      return new AdminExternalAccountsContainer();
    },
  ],
});

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminExternalAccountsPage;
