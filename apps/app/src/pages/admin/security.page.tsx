import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { _atomsForAdminPagesHydration as atoms } from '~/states/global';
import { isMailerSetupAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const SecurityManagement = dynamic(
  () => import('~/client/components/Admin/Security/SecurityManagement'),
  { ssr: false },
);

type ExtraProps = {
  isMailerSetup: boolean;
};
type Props = AdminCommonProps & ExtraProps;

const AdminSecuritySettingsPage: NextPageWithLayout<Props> = (props: Props) => {
  // hydrate
  useHydrateAtoms(
    [
      [isMailerSetupAtom, props.isMailerSetup],
      [atoms.siteUrlWithEmptyValueWarnAtom, props.siteUrlWithEmptyValueWarn],
    ],
    { dangerouslyForceHydrate: true },
  );

  return <SecurityManagement />;
};

AdminSecuritySettingsPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('security_settings.security_settings'),
  containerFactories: [
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGeneralSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminLocalSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminLdapSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminSamlSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminOidcSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGoogleSecurityContainer'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGitHubSecurityContainer'
      );
      return new C();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const commonResult = await getServerSideAdminCommonProps(context);

  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { mailService } = crowi;
  const extraProps = {
    props: {
      isMailerSetup: mailService.isMailerSetup,
    },
  } satisfies { props: ExtraProps };

  return mergeGetServerSidePropsResults(commonResult, extraProps);
};

export default AdminSecuritySettingsPage;
