import { useEffect, useMemo } from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import type { Container } from 'unstated';
import { Provider } from 'unstated';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import {
  useCurrentUser,
  useGrowiAppIdForGrowiCloud,
  useGrowiCloudUri,
} from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const AdminHome = dynamic(
  () => import('~/client/components/Admin/AdminHome/AdminHome'),
  { ssr: false },
);
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);

type Props = CommonProps & {
  growiCloudUri?: string;
  growiAppIdForGrowiCloud?: number;
};

const AdminHomepage: NextPage<Props> = (props: Props) => {
  useCurrentUser(props.currentUser ?? null);
  useGrowiCloudUri(props.growiCloudUri);
  useGrowiAppIdForGrowiCloud(props.growiAppIdForGrowiCloud);

  const { t } = useTranslation('admin');

  const title = generateCustomTitle(props, t('wiki_management_homepage'));

  const injectableContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async () => {
      const AdminHomeContainer = (
        await import('~/client/services/AdminHomeContainer')
      ).default;
      const adminHomeContainer = new AdminHomeContainer();
      injectableContainers.push(adminHomeContainer);
    })();
  }, [injectableContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout componentTitle={title}>
        <Head>
          <title>{title}</title>
        </Head>
        <AdminHome />
      </AdminLayout>
    </Provider>
  );
};

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;

  props.growiCloudUri = crowi.configManager.getConfig('app:growiCloudUri');
  props.growiAppIdForGrowiCloud = crowi.configManager.getConfig(
    'app:growiAppIdForCloud',
  );
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const props = await retrieveServerSideProps(
    context,
    injectServerConfigurations,
  );
  return props;
};

export default AdminHomepage;
