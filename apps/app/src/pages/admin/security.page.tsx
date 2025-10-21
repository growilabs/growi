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
  useIsMailerSetup,
  useSiteUrl,
} from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), {
  ssr: false,
});
const SecurityManagement = dynamic(
  () => import('~/client/components/Admin/Security/SecurityManagement'),
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
  isMailerSetup: boolean;
  siteUrl: string;
};

const AdminSecuritySettingsPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);
  useSiteUrl(props.siteUrl);
  useIsMailerSetup(props.isMailerSetup);

  const componentTitle = t('security_settings.security_settings');
  const pageTitle = generateCustomTitle(props, componentTitle);

  const adminSecurityContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async () => {
      const AdminGeneralSecurityContainer = (
        await import('~/client/services/AdminGeneralSecurityContainer')
      ).default;
      const adminGeneralSecurityContainer = new AdminGeneralSecurityContainer();

      const AdminLocalSecurityContainer = (
        await import('~/client/services/AdminLocalSecurityContainer')
      ).default;
      const adminLocalSecurityContainer = new AdminLocalSecurityContainer();

      const AdminLdapSecurityContainer = (
        await import('~/client/services/AdminLdapSecurityContainer')
      ).default;
      const adminLdapSecurityContainer = new AdminLdapSecurityContainer();

      const AdminSamlSecurityContainer = (
        await import('~/client/services/AdminSamlSecurityContainer')
      ).default;
      const adminSamlSecurityContainer = new AdminSamlSecurityContainer();

      const AdminOidcSecurityContainer = (
        await import('~/client/services/AdminOidcSecurityContainer')
      ).default;
      const adminOidcSecurityContainer = new AdminOidcSecurityContainer();

      const AdminGoogleSecurityContainer = (
        await import('~/client/services/AdminGoogleSecurityContainer')
      ).default;
      const adminGoogleSecurityContainer = new AdminGoogleSecurityContainer();

      const AdminGitHubSecurityContainer = (
        await import('~/client/services/AdminGitHubSecurityContainer')
      ).default;
      const adminGitHubSecurityContainer = new AdminGitHubSecurityContainer();

      adminSecurityContainers.push(
        adminGeneralSecurityContainer,
        adminLocalSecurityContainer,
        adminLdapSecurityContainer,
        adminSamlSecurityContainer,
        adminOidcSecurityContainer,
        adminGoogleSecurityContainer,
        adminGitHubSecurityContainer,
      );
    })();
  }, [adminSecurityContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={[...adminSecurityContainers]}>
      <AdminLayout componentTitle={componentTitle}>
        <Head>
          <title>{pageTitle}</title>
        </Head>
        <SecurityManagement />
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
  const { growiInfoService, mailService } = crowi;

  props.siteUrl = growiInfoService.getSiteUrl();
  props.isMailerSetup = mailService.isMailerSetup;
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

export default AdminSecuritySettingsPage;
