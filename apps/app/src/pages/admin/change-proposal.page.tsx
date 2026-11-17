import type { GetServerSideProps } from 'next';
import dynamic from 'next/dynamic';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const ChangeProposalSettings = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/features/change-proposal/client/admin').then(
      (m) => m.ChangeProposalSettings,
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminChangeProposalPage: NextPageWithLayout<Props> = () => (
  <ChangeProposalSettings />
);

AdminChangeProposalPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) =>
    t('admin:change_proposal_settings.change_proposal_settings'),
  containerFactories: [],
});

export const getServerSideProps: GetServerSideProps = async (context) => {
  return getServerSideAdminCommonProps(context);
};

export default AdminChangeProposalPage;
