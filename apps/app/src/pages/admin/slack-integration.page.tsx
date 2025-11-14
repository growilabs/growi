import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import { useCurrentUser, useSiteUrl } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const SlackIntegration = dynamic(
  () =>
    import('~/client/components/Admin/SlackIntegration/SlackIntegration').then(
      (mod) => mod.SlackIntegration,
    ),
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
  siteUrl: string;
};

const AdminSlackIntegrationPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);
  useSiteUrl(props.siteUrl);

  const componentTitle = t('slack_integration.slack_integration');
  const pageTitle = generateCustomTitle(props, componentTitle);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <AdminLayout componentTitle={componentTitle}>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <SlackIntegration />
    </AdminLayout>
  );
};

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { growiInfoService } = crowi;

  props.siteUrl = growiInfoService.getSiteUrl();
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

export default AdminSlackIntegrationPage;
