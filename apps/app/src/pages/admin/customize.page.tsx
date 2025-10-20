import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import dynamic from 'next/dynamic';
import { useHydrateAtoms } from 'jotai/utils';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { _atomsForAdminPagesHydration as atoms } from '~/states/global';
import { isCustomizedLogoUploadedAtom } from '~/states/server-configurations';

import type { NextPageWithLayout } from '../_app.page';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';
import type { AdminCommonProps } from './_shared';
import {
  createAdminPageLayout,
  getServerSideAdminCommonProps,
} from './_shared';

const CustomizeSettingContents = dynamic(
  () => import('~/client/components/Admin/Customize/Customize'),
  { ssr: false },
);

type PageProps = {
  isDefaultBrandLogoUsed: boolean;
  isCustomizedLogoUploaded: boolean;
  customTitleTemplate?: string;
};

type Props = AdminCommonProps & PageProps;

// eslint-disable-next-line react/prop-types
const AdminCustomizeSettingsPage: NextPageWithLayout<Props> = (
  props: Props,
) => {
  useHydrateAtoms(
    [
      [atoms.isDefaultLogoAtom, props.isDefaultBrandLogoUsed],
      [atoms.customTitleTemplateAtom, props.customTitleTemplate],
      [isCustomizedLogoUploadedAtom, props.isCustomizedLogoUploaded],
    ],
    { dangerouslyForceHydrate: true },
  );

  return <CustomizeSettingContents />;
};

AdminCustomizeSettingsPage.getLayout = createAdminPageLayout<Props>({
  title: (_p, t) => t('customize_settings.customize_settings'),
  containerFactories: [
    async () => {
      const C = (await import('~/client/services/AdminCustomizeContainer'))
        .default;
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

  const customizePropsFragment = {
    props: {
      isDefaultBrandLogoUsed:
        await crowi.attachmentService.isDefaultBrandLogoUsed(),
      isCustomizedLogoUploaded:
        await crowi.attachmentService.isBrandLogoExist(),
      customTitleTemplate: crowi.configManager.getConfig('customize:title'),
    },
  } satisfies { props: PageProps };

  return mergeGetServerSidePropsResults(commonResult, customizePropsFragment);
};

export default AdminCustomizeSettingsPage;
