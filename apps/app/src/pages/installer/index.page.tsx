import React, { useMemo } from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const InstallerForm = dynamic(
  () => import('~/client/components/InstallerForm'),
  { ssr: false },
);
const DataTransferForm = dynamic(
  () => import('~/client/components/DataTransferForm'),
  { ssr: false },
);
const CustomNavAndContents = dynamic(
  () => import('~/client/components/CustomNavigation/CustomNavAndContents'),
  { ssr: false },
);
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type ServerConfigurationProps = {
  minPasswordLength: number;
};

type Props = CommonInitialProps & CommonEachProps & ServerConfigurationProps;

const UserInfoIcon = () => (
  <span className="material-symbols-outlined me-2">person</span>
);

const ExternalAccountsIcon = () => (
  <span className="growi-custom-icons me-2">external_link</span>
);

const InstallerPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();
  const { t: tCommons } = useTranslation('commons');

  const BoundInstallerForm = useMemo(
    () => () => <InstallerForm minPasswordLength={props.minPasswordLength} />,
    [props.minPasswordLength],
  );

  const navTabMapping = useMemo(() => {
    return {
      user_infomation: {
        Icon: UserInfoIcon,
        Content: BoundInstallerForm,
        i18n: t('installer.tab'),
      },
      external_accounts: {
        // TODO: chack and fix font-size. see: https://redmine.weseek.co.jp/issues/143015
        Icon: ExternalAccountsIcon,
        Content: DataTransferForm,
        i18n: tCommons('g2g_data_transfer.tab'),
      },
    };
  }, [BoundInstallerForm, t, tCommons]);

  const title = useCustomTitle(t('installer.title'));
  const classNames: string[] = [];

  return (
    <NoLoginLayout className={classNames.join(' ')}>
      <Head>
        <title>{title}</title>
      </Head>
      <div
        id="installer-form-container"
        className="nologin-dialog mx-auto rounded-4 rounded-top-0"
      >
        <CustomNavAndContents
          navTabMapping={navTabMapping}
          tabContentClasses={['p-0']}
        />
      </div>
    </NoLoginLayout>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  return {
    props: {
      minPasswordLength: configManager.getConfig('app:minPasswordLength'),
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [
    commonInitialResult,
    commonEachResult,
    serverConfigResult,
    i18nPropsResult,
  ] = await Promise.all([
    getServerSideCommonInitialProps(context),
    getServerSideCommonEachProps(context),
    getServerSideConfigurationProps(context),
    getServerSideI18nProps(context, ['translation'], { preloadAllLang: true }),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
    ),
  );
};

export default InstallerPage;
