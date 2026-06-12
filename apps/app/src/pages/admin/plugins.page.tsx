import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page.js';
import type { AdminCommonProps } from './_shared/index.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared/index.js';

const PluginsExtensionPageContents = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/growi-plugin/client/Admin/components/index.js').then(
      (mod) => mod.PluginsExtensionPageContents,
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminAppPage: NextPageWithLayout<Props> = () => (
  <PluginsExtensionPageContents />
);

AdminAppPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('plugins.plugins'),
  containerFactories: [
    async () => {
      const AdminAppContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminAppContainer.js')).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminAppPage;
