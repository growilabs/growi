import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AiSettings = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/mastra/client/admin').then((m) => m.AiSettings),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminAiPage: NextPageWithLayout<Props> = () => <AiSettings />;

AdminAiPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('ai_settings.ai_settings'),
  containerFactories: [],
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  return getServerSideAdminCommonProps(context, { preloadAllLang: true });
};

export default AdminAiPage;
