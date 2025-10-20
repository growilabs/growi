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
import type { UserActivationErrorCode } from '~/interfaces/errors/user-activation';
import type { RegistrationMode } from '~/interfaces/registration-mode';
import type { ReqWithUserRegistrationOrder } from '~/server/middlewares/inject-user-registration-order-by-token-middleware';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

const CompleteUserRegistrationForm = dynamic(
  () =>
    import('~/client/components/CompleteUserRegistrationForm').then(
      (mod) => mod.CompleteUserRegistrationForm,
    ),
  { ssr: false },
);

type ServerConfigurationProps = {
  token: string;
  email: string;
  errorCode?: UserActivationErrorCode;
  registrationMode: RegistrationMode;
  isEmailAuthenticationEnabled: boolean;
};

type Props = CommonInitialProps & CommonEachProps & ServerConfigurationProps;

const UserActivationPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  const title = useCustomTitle(t('User Activation'));

  return (
    <NoLoginLayout>
      <Head>
        <title>{title}</title>
      </Head>
      <CompleteUserRegistrationForm
        token={props.token}
        email={props.email}
        errorCode={props.errorCode}
        registrationMode={props.registrationMode}
        isEmailAuthenticationEnabled={props.isEmailAuthenticationEnabled}
      />
    </NoLoginLayout>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req = context.req as ReqWithUserRegistrationOrder & CrowiRequest;

  const { configManager } = req.crowi;

  const errorCode = context.query.errorCode as UserActivationErrorCode;
  return {
    props: {
      email: req.userRegistrationOrder?.email ?? '',
      token: req.userRegistrationOrder?.token ?? '',
      errorCode: typeof errorCode === 'string' ? errorCode : undefined,
      registrationMode: configManager.getConfig('security:registrationMode'),
      isEmailAuthenticationEnabled: configManager.getConfig(
        'security:passport-local:isEmailAuthenticationEnabled',
      ),
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
    getServerSideI18nProps(context, ['translation']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
    ),
  );
};

export default UserActivationPage;
