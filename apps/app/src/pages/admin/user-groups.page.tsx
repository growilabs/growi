import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { isAclEnabledAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const UserGroupPage = dynamic(
  () =>
    // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
    import('~/client/components/Admin/UserGroup/UserGroupPage').then(
      (mod) => mod.UserGroupPage,
    ),
  { ssr: false },
);

type PageProps = { isAclEnabled: boolean };
type Props = AdminCommonProps & PageProps;

const AdminUserGroupPage: NextPageWithLayout<Props> = (props: Props) => {
  // hydrate
  useHydrateAtoms([[isAclEnabledAtom, props.isAclEnabled]], {
    dangerouslyForceHydrate: true,
  });

  return <UserGroupPage />;
};

AdminUserGroupPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('user_group_management.user_group_management'),
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const baseResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { aclService } = crowi;

  const fragment = {
    props: { isAclEnabled: aclService.isAclEnabled() },
  } satisfies { props: PageProps };
  return mergeGetServerSidePropsResults(baseResult, fragment);
};

export default AdminUserGroupPage;
