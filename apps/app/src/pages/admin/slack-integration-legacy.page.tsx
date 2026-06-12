import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page.js';
import type { AdminCommonProps } from './_shared/index.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared/index.js';

const LegacySlackIntegration = dynamic(
  () =>
    import(
      // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
      '~/client/components/Admin/LegacySlackIntegration/LegacySlackIntegration.js'
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminLegacySlackIntegrationPage: NextPageWithLayout<Props> = () => (
  <LegacySlackIntegration />
);

AdminLegacySlackIntegrationPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('slack_integration_legacy.slack_integration_legacy'),
  containerFactories: [
    async () => {
      const AdminSlackIntegrationLegacyContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminSlackIntegrationLegacyContainer.js'))
          .default;
      return new AdminSlackIntegrationLegacyContainer();
    },
  ],
});

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminLegacySlackIntegrationPage;
