import { useMemo } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { isAclEnabledAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../../_app.page';
import { mergeGetServerSidePropsResults } from '../../utils/server-side-props';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const UserGroupDetailPage = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/UserGroupDetail/UserGroupDetailPage'),
  { ssr: false },
);

type PageProps = { isAclEnabled: boolean };
type Props = AdminCommonProps & PageProps;

const AdminUserGroupDetailPage: NextPageWithLayout<Props> = (props: Props) => {
  const router = useRouter();

  // hydrate
  useHydrateAtoms([[isAclEnabledAtom, props.isAclEnabled]], {
    dangerouslyForceHydrate: true,
  });

  const { userGroupId, isExternalGroup } = router.query;
  const id = useMemo(
    () => (Array.isArray(userGroupId) ? userGroupId[0] : userGroupId),
    [userGroupId],
  );
  const isExternal = isExternalGroup === 'true';

  return id != null && router.isReady ? (
    <UserGroupDetailPage userGroupId={id} isExternalGroup={isExternal} />
  ) : null;
};

AdminUserGroupDetailPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('user_group_management.user_group_management'),
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const commonResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;

  const UserGroupDetailPropsFragment = {
    props: {
      isAclEnabled: crowi.aclService.isAclEnabled(),
    },
  } satisfies { props: PageProps };

  return mergeGetServerSidePropsResults(
    commonResult,
    UserGroupDetailPropsFragment,
  );
};

export default AdminUserGroupDetailPage;
