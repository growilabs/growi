import React, { useMemo } from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import {
  useAppTitle,
  useConfidential,
  useCsrfToken,
  useGrowiCloudUri,
  useSiteUrl,
} from '~/stores-universal/context';

import type { CommonProps } from './utils/commons';
import {
  generateCustomTitle,
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

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

async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
    true,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
}

type Props = CommonProps & {
  minPasswordLength: number;
  pageWithMetaStr: string;
};

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

  // commons
  useAppTitle(props.appTitle);
  useSiteUrl(props.siteUrl);
  useConfidential(props.confidential);
  useCsrfToken(props.csrfToken);
  useGrowiCloudUri(props.growiCloudUri);

  const title = generateCustomTitle(props, t('installer.title'));
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

async function injectServerConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
): Promise<void> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager } = crowi;

  props.minPasswordLength = configManager.getConfig('app:minPasswordLength');
}

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const result = await getServerSideCommonProps(context);

  // check for presence
  // see: https://github.com/vercel/next.js/issues/19271#issuecomment-730006862
  if (!('props' in result)) {
    throw new Error('invalid getSSP result');
  }

  const props: Props = result.props as Props;

  await injectNextI18NextConfigurations(context, props, ['translation']);
  injectServerConfigurations(context, props);

  return {
    props,
  };
};

export default InstallerPage;
