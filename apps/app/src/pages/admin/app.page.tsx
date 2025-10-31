import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AppSettingsPageContents = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/App/AppSettingsPageContents'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminAppPage: NextPageWithLayout<Props> = () => (
  <AppSettingsPageContents />
);

AdminAppPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('headers.app_settings', { ns: 'commons' }),
  containerFactories: [
    async () => {
      const AdminAppContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminAppContainer')).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  return getServerSideAdminCommonProps(context, { preloadAllLang: true });
};

export default AdminAppPage;
