import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const PluginsExtensionPageContents = dynamic(
  () =>
    import('~/features/growi-plugin/client/Admin/components').then(
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
      const AdminAppContainer = (
        await import('~/client/services/AdminAppContainer')
      ).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminAppPage;
