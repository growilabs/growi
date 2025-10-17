import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useHydrateAtoms } from 'jotai/utils';

import { isAclEnabledAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../../_app.page';
import type { AdminCommonProps } from '../_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from '../_shared';

const UserGroupDetailPage = dynamic(
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

export const getServerSideProps = getServerSideAdminCommonProps;

export default AdminUserGroupDetailPage;
