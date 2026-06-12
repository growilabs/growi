import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const VaultAdminSettings = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/growi-vault/client/admin').then(
      (m) => m.VaultAdminSettings,
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminVaultPage: NextPageWithLayout<Props> = () => <VaultAdminSettings />;

AdminVaultPage.getLayout = createAdminPageLayout<Props>({
  title: () => 'GROWI Vault',
  containerFactories: [],
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  return getServerSideAdminCommonProps(context, { preloadAllLang: true });
};

export default AdminVaultPage;
