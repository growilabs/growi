import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request.js';
import { _atomsForAdminPagesHydration as atoms } from '~/states/global/index.js';
import { isMailerSetupAtom } from '~/states/server-configurations/index.js';

import type { NextPageWithLayout } from '../_app.page.js';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props.js';
import type { AdminCommonProps } from './_shared/index.js';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared/index.js';

const SecurityManagement = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/Security/SecurityManagement.js'),
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

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
AdminSecuritySettingsPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('security_settings.security_settings'),
  containerFactories: [
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGeneralSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminLocalSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminLdapSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminSamlSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminOidcSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGoogleSecurityContainer.js'
      );
      return new C();
    },
    async () => {
      const { default: C } = await import(
        '~/client/services/AdminGitHubSecurityContainer.js'
      );
      return new C();
    },
  ],
});
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

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
