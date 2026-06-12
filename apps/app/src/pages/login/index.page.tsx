import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import {
  isPermalink,
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import { useTranslation } from 'next-i18next';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { IExternalAccountLoginError } from '~/interfaces/errors/external-account-login-error';
import { IExternalAuthProviderType } from '~/interfaces/external-auth-provider';
import type { RegistrationMode } from '~/interfaces/registration-mode';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { useCustomTitle } from '../utils/page-title-customization';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

import styles from './index.module.scss';

const LoginForm = dynamic(
  // biome-ignore lint/style/noRestrictedImports: no-problem dynamic import
  () => import('~/client/components/LoginForm').then((mod) => mod.LoginForm),
  { ssr: false },
);

type ServerConfigurationProps = {
  registrationMode: RegistrationMode;
  isMailerSetup: boolean;
  enabledExternalAuthType: IExternalAuthProviderType[];
  registrationWhitelist: string[];
  isLocalStrategySetup: boolean;
  isLdapStrategySetup: boolean;
  isLdapSetupFailed: boolean;
  isPasswordResetEnabled: boolean;
  isEmailAuthenticationEnabled: boolean;
  externalAccountLoginError?: IExternalAccountLoginError;
  minPasswordLength: number;
};

type Props = CommonInitialProps & CommonEachProps & ServerConfigurationProps;

const LoginPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  const title = useCustomTitle(t('login.title'));
  const classNames: string[] = ['login-page', styles['login-page']];

  return (
    <NoLoginLayout className={classNames.join(' ')}>
      <Head>
        <title>{title}</title>
      </Head>
      <LoginForm
        enabledExternalAuthType={props.enabledExternalAuthType}
        isLocalStrategySetup={props.isLocalStrategySetup}
        isLdapStrategySetup={props.isLdapStrategySetup}
        isLdapSetupFailed={props.isLdapSetupFailed}
        isEmailAuthenticationEnabled={props.isEmailAuthenticationEnabled}
        registrationWhitelist={props.registrationWhitelist}
        isPasswordResetEnabled={props.isPasswordResetEnabled}
        isMailerSetup={props.isMailerSetup}
        registrationMode={props.registrationMode}
        externalAccountLoginError={props.externalAccountLoginError}
        minPasswordLength={props.minPasswordLength}
      />
    </NoLoginLayout>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<
  ServerConfigurationProps
> = async (context: GetServerSidePropsContext) => {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi } = req;
  const { configManager, mailService, passportService } = crowi;

  return {
    props: {
      enabledExternalAuthType: [
        configManager.getConfig('security:passport-google:isEnabled') === true
          ? IExternalAuthProviderType.google
          : undefined,
        configManager.getConfig('security:passport-github:isEnabled') === true
          ? IExternalAuthProviderType.github
          : undefined,
        configManager.getConfig('security:passport-saml:isEnabled') === true
          ? IExternalAuthProviderType.saml
          : undefined,
        configManager.getConfig('security:passport-oidc:isEnabled') === true
          ? IExternalAuthProviderType.oidc
          : undefined,
      ].filter(
        (authType): authType is Exclude<typeof authType, undefined> =>
          authType != null,
      ),
      isPasswordResetEnabled: configManager.getConfig(
        'security:passport-local:isPasswordResetEnabled',
      ),
      isMailerSetup: mailService.isMailerSetup,
      isLocalStrategySetup: passportService.isLocalStrategySetup,
      isLdapStrategySetup: passportService.isLdapStrategySetup,
      isLdapSetupFailed:
        configManager.getConfig('security:passport-ldap:isEnabled') &&
        !passportService.isLdapStrategySetup,
      registrationWhitelist: configManager.getConfig(
        'security:registrationWhitelist',
      ),
      isEmailAuthenticationEnabled: configManager.getConfig(
        'security:passport-local:isEmailAuthenticationEnabled',
      ),
      registrationMode: configManager.getConfig('security:registrationMode'),
      minPasswordLength: configManager.getConfig('app:minPasswordLength'),
    },
  };
};

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const req: CrowiRequest = context.req as CrowiRequest;

  // redirect to the page the user was on before moving to the Login Page
  if (req.headers.referer != null) {
    const urlBeforeLogin = new URL(req.headers.referer);
    if (
      isPermalink(urlBeforeLogin.pathname) ||
      isUserPage(urlBeforeLogin.pathname) ||
      isUsersTopPage(urlBeforeLogin.pathname)
    ) {
      req.session.redirectTo = urlBeforeLogin.href;
    }
  }

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

export default LoginPage;
