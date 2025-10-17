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

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const ForbiddenPage = dynamic(
  () =>
    import('~/client/components/Admin/ForbiddenPage').then(
      (mod) => mod.ForbiddenPage,
    ),
  { ssr: false },
);
const AiIntegration = dynamic(
  () =>
    import(
      '~/features/openai/client/components/AiIntegration/AiIntegration'
    ).then((mod) => mod.AiIntegration),
  { ssr: false },
);
const AiIntegrationDisableMode = dynamic(
  () =>
    import(
      '~/features/openai/client/components/AiIntegration/AiIntegrationDisableMode'
    ).then((mod) => mod.AiIntegrationDisableMode),
  { ssr: false },
);

type Props = CommonProps & {
  aiEnabled: boolean;
};

const AdminAiIntegrationPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation('admin');

  const title = t('ai_integration.ai_integration');
  const headTitle = generateCustomTitle(props, title);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <AdminLayout componentTitle={title}>
      <Head>
        <title>{headTitle}</title>
      </Head>
      {props.aiEnabled ? <AiIntegration /> : <AiIntegrationDisableMode />}
    </AdminLayout>
  );
};

const injectServerConfigurations = async (
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  props.aiEnabled = configManager.getConfig('app:aiEnabled');
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

export default AdminAiIntegrationPage;
