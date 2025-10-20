import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const LegacySlackIntegration = dynamic(
  () =>
    import(
      '~/client/components/Admin/LegacySlackIntegration/LegacySlackIntegration'
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
      const AdminSlackIntegrationLegacyContainer = (
        await import('~/client/services/AdminSlackIntegrationLegacyContainer')
      ).default;
      return new AdminSlackIntegrationLegacyContainer();
    },
  ],
});

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminLegacySlackIntegrationPage;
