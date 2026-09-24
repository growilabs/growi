import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AdminChatIntegration = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/chat-integration/client/admin').then(
      (m) => m.AdminChatIntegration,
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminChatIntegrationPage: NextPageWithLayout<Props> = () => (
  <AdminChatIntegration />
);

AdminChatIntegrationPage.getLayout = createAdminPageLayout<Props>({
  title: () => 'Chat Integration',
  containerFactories: [],
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  return getServerSideAdminCommonProps(context);
};

export default AdminChatIntegrationPage;
