import { isClient } from '@growi/core';
import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { Container, Provider } from 'unstated';

import AdminNotificationContainer from '~/client/services/AdminNotificationContainer';
import { CommonProps, useCustomTitle } from '~/pages/utils/commons';
import { useCurrentUser } from '~/stores/context';

import { retrieveServerSideProps } from '../../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });
const ManageGlobalNotification = dynamic(() => import('~/components/Admin/Notification/ManageGlobalNotification'), { ssr: false });


const AdminGlobalNotificationNewPage: NextPage<CommonProps> = (props) => {
  const { t } = useTranslation('admin');
  useCurrentUser(props.currentUser ?? null);

  const title = t('external_notification.external_notification');
  const injectableContainers: Container<any>[] = [];

  if (isClient()) {
    const adminNotificationContainer = new AdminNotificationContainer();
    injectableContainers.push(adminNotificationContainer);
  }


  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout title={useCustomTitle(props, title)} componentTitle={title} >
        <ManageGlobalNotification />
      </AdminLayout>
    </Provider>
  );

};


export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context);
  return props;
};


export default AdminGlobalNotificationNewPage;
