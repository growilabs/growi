import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import { langDisplayNamesAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import type { LangDisplayNames } from '../common-props/lang-display-names';
import { getLangDisplayNames } from '../common-props/lang-display-names';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const AppSettingsPageContents = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/Admin/App/AppSettingsPageContents'),
  { ssr: false },
);

type PageProps = {
  langDisplayNames: LangDisplayNames;
};

type Props = AdminCommonProps & PageProps;

const AdminAppPage: NextPageWithLayout<Props> = (props: Props) => {
  useHydrateAtoms([[langDisplayNamesAtom, props.langDisplayNames]], {
    dangerouslyForceHydrate: true,
  });

  return <AppSettingsPageContents />;
};

AdminAppPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('headers.app_settings', { ns: 'commons' }),
  containerFactories: [
    async () => {
      const AdminAppContainer =
        // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
        (await import('~/client/services/AdminAppContainer')).default;
      return new AdminAppContainer();
    },
  ],
});

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: GetServerSidePropsContext,
) => {
  const commonResult = await getServerSideAdminCommonProps(context);

  const langDisplayNamesFragment = {
    props: { langDisplayNames: getLangDisplayNames() },
  } satisfies { props: PageProps };

  return mergeGetServerSidePropsResults(commonResult, langDisplayNamesFragment);
};

export default AdminAppPage;
