import { isClient } from '@growi/core';
import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { Container, Provider } from 'unstated';


import AdminMarkDownContainer from '~/client/services/AdminMarkDownContainer';
import { CommonProps, useCustomTitle } from '~/pages/utils/commons';
import { useCurrentUser } from '~/stores/context';

import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });
const MarkDownSettingContents = dynamic(() => import('~/components/Admin/MarkdownSetting/MarkDownSettingContents'), { ssr: false });


const AdminMarkdownPage: NextPage<CommonProps> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);

  const title = t('markdown_settings.markdown_settings');
  const injectableContainers: Container<any>[] = [];

  if (isClient()) {
    const adminMarkDownContainer = new AdminMarkDownContainer();
    injectableContainers.push(adminMarkDownContainer);
  }


  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout title={useCustomTitle(props, title)} componentTitle={title} >
        <MarkDownSettingContents />
      </AdminLayout>
    </Provider>
  );

};


export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context);
  return props;
};


export default AdminMarkdownPage;
