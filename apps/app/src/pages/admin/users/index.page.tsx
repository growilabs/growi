import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { isMailerSetupAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../../_app.page';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const UserManagement = dynamic(
  () => import('~/client/components/Admin/UserManagement'),
  { ssr: false },
);

type PageProps = { isMailerSetup: boolean };
type Props = AdminCommonProps & PageProps;

const AdminUserManagementPage: NextPageWithLayout<Props> = (props: Props) => {
  // hydrate
  useHydrateAtoms([[isMailerSetupAtom, props.isMailerSetup]], {
    dangerouslyForceHydrate: true,
  });
  return <UserManagement />;
};

AdminUserManagementPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('user_management.user_management'),
  containerFactories: [
    async () => {
      const AdminUsersContainer = (
        await import('~/client/services/AdminUsersContainer')
      ).default;
      return new AdminUsersContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const baseResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { mailService } = crowi;

  const fragment = {
    props: { isMailerSetup: mailService.isMailerSetup },
  } satisfies { props: PageProps };
  return mergeGetServerSidePropsResults(baseResult, fragment);
};

export default AdminUserManagementPage;
