import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import { _atomsForAdminPagesHydration as atoms } from '~/states/global';

import type { NextPageWithLayout } from '../_app.page';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const SlackIntegration = dynamic(
  () =>
    import('~/client/components/Admin/SlackIntegration/SlackIntegration').then(
      (mod) => mod.SlackIntegration,
    ),
  { ssr: false },
);

type Props = AdminCommonProps;

const AdminSlackIntegrationPage: NextPageWithLayout<Props> = (props: Props) => {
  // hydrate global state
  useHydrateAtoms(
    [[atoms.siteUrlWithEmptyValueWarnAtom, props.siteUrlWithEmptyValueWarn]],
    { dangerouslyForceHydrate: true },
  );

  return <SlackIntegration />;
};

AdminSlackIntegrationPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('slack_integration.slack_integration'),
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  return getServerSideAdminCommonProps(context);
};

export default AdminSlackIntegrationPage;
