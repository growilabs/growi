import { isClient } from '@growi/core';
import {
  NextPage, GetServerSideProps, GetServerSidePropsContext,
} from 'next';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { Container, Provider } from 'unstated';

import AdminHomeContainer from '~/client/services/AdminHomeContainer';
import { CrowiRequest } from '~/interfaces/crowi-request';
import { CommonProps, useCustomTitle } from '~/pages/utils/commons';
import PluginUtils from '~/server/plugins/plugin-utils';

import { useGrowiCloudUri, useGrowiAppIdForGrowiCloud } from '../../stores/context';
import { retrieveServerSideProps } from '../../utils/admin-page-util';

const AdminLayout = dynamic(() => import('~/components/Layout/AdminLayout'), { ssr: false });
const AdminHome = dynamic(() => import('~/components/Admin/AdminHome/AdminHome'), { ssr: false });


type Props = CommonProps & {
  nodeVersion: string,
  npmVersion: string,
  yarnVersion: string,
  installedPlugins: any,
  growiCloudUri: string,
  growiAppIdForGrowiCloud: number,
};


const AdminHomePage: NextPage<Props> = (props) => {

  useGrowiCloudUri(props.growiCloudUri);
  useGrowiAppIdForGrowiCloud(props.growiAppIdForGrowiCloud);

  const { t } = useTranslation('admin');

  const title = t('wiki_management_home_page');
  const injectableContainers: Container<any>[] = [];

  if (isClient()) {
    const adminHomeContainer = new AdminHomeContainer();

    injectableContainers.push(adminHomeContainer);
  }


  return (
    <Provider inject={[...injectableContainers]}>
      <AdminLayout title={useCustomTitle(props, title)} componentTitle={title} >
        <AdminHome
          nodeVersion={props.nodeVersion}
          npmVersion={props.npmVersion}
          yarnVersion={props.yarnVersion}
          installedPlugins={props.installedPlugins}
        />
      </AdminLayout>
    </Provider>
  );
};


const injectServerConfigurations = async(context: GetServerSidePropsContext, props: Props): Promise<void> => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const pluginUtils = new PluginUtils();

  props.nodeVersion = crowi.runtimeVersions.versions.node ? crowi.runtimeVersions.versions.node.version.version : null;
  props.npmVersion = crowi.runtimeVersions.versions.npm ? crowi.runtimeVersions.versions.npm.version.version : null;
  props.yarnVersion = crowi.runtimeVersions.versions.yarn ? crowi.runtimeVersions.versions.yarn.version.version : null;
  props.installedPlugins = pluginUtils.listPlugins();
  props.growiCloudUri = await crowi.configManager.getConfig('crowi', 'app:growiCloudUri');
  props.growiAppIdForGrowiCloud = await crowi.configManager.getConfig('crowi', 'app:growiAppIdForCloud');
};


export const getServerSideProps: GetServerSideProps = async(context: GetServerSidePropsContext) => {
  const props = await retrieveServerSideProps(context, injectServerConfigurations);
  return props;
};


export default AdminHomePage;
