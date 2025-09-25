import { useEffect, useMemo } from 'react';

import type {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import type { Container } from 'unstated';
import { Provider } from 'unstated';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { CommonProps } from '~/pages/utils/commons';
import { generateCustomTitle } from '~/pages/utils/commons';
import { configManager } from '~/server/service/config-manager';
import { useCustomizeTitle, useCurrentUser, useIsCustomizedLogoUploaded } from '~/stores-universal/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });
const CustomizeSettingContents = dynamic(() => import('~/client/components/Admin/Customize/Customize'), { ssr: false });
const ForbiddenPage = dynamic(() => import('~/client/components/Admin/ForbiddenPage').then(mod => mod.ForbiddenPage), { ssr: false });


type Props = CommonProps & {
  customizeTitle?: string,
  isCustomizedLogoUploaded: boolean,
};


const AdminCustomizeSettingsPage: NextPage<Props> = (props) => {
  const { t } = useTranslation('admin');
  useCustomizeTitle(props.customizeTitle);
  useCurrentUser(props.currentUser ?? null);
  useIsCustomizedLogoUploaded(props.isCustomizedLogoUploaded);

  const componentTitle = t('customize_settings.customize_settings');
  const pageTitle = generateCustomTitle(props, componentTitle);
  const injectableContainers: Container<any>[] = useMemo(() => [], []);

  useEffect(() => {
    (async() => {
      const AdminCustomizeContainer = (await import('~/client/services/AdminCustomizeContainer')).default;
      const adminCustomizeContainer = new AdminCustomizeContainer();
      injectableContainers.push(adminCustomizeContainer);
    })();
  }, [injectableContainers]);

  if (props.isAccessDeniedForNonAdminUser) {
    return <ForbiddenPage />;
  }

  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout componentTitle={componentTitle}>
        <Head>
          <title>{pageTitle}</title>
        </Head>
        <CustomizeSettingContents />
      </AdminLayout>
    </Provider>
  );
};


const injectServerConfigurations = async(context: GetServerSidePropsContext, props: Props): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;

  props.customizeTitle = crowi.configManager.getConfig('customize:title');
  props.isCustomizedLogoUploaded = await crowi.attachmentService.isBrandLogoExist();
};

export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context, injectServerConfigurations);
  return props;
};


export default AdminCustomizeSettingsPage;
