import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const MarkDownSettingContents = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/MarkdownSetting/MarkDownSettingContents'),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminMarkdownPage: NextPageWithLayout<Props> = () => (
  <MarkDownSettingContents />
);

AdminMarkdownPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('markdown_settings.markdown_settings'),
  containerFactories: [
    async () => {
      const AdminMarkDownContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminMarkDownContainer')).default;
      return new AdminMarkDownContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps =
  getServerSideAdminCommonProps;

export default AdminMarkdownPage;
