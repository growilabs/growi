import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';

import { RawLayout } from '~/components/Layout/RawLayout';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

type Props = CommonInitialProps &
  CommonEachProps & {
    email: string;
  };

const PasswordResetExecutionForm = dynamic(
  () => import('~/client/components/PasswordResetExecutionForm'),
  { ssr: false },
);

const ForgotPasswordPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();

  return (
    <RawLayout>
      <div className="main">
        <div className="container-lg">
          <div className="container">
            <div className="row justify-content-md-center">
              <div className="col-md-6 mt-5">
                <div className="text-center">
                  <h1>
                    <span className="material-symbols-outlined large">
                      lock_open
                    </span>
                  </h1>
                  <h2 className="text-center">
                    {t('forgot_password.reset_password')}
                  </h2>
                  <h5>{props.email}</h5>
                  <p className="mt-4">
                    {t('forgot_password.password_reset_excecution_desc')}
                  </p>
                  <PasswordResetExecutionForm />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RawLayout>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<{
  email: string;
}> = async (context: GetServerSidePropsContext) => {
  const email = context.query.email;
  return {
    props: {
      email: typeof email === 'string' ? email : '',
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
    getServerSideI18nProps(context, ['translation', 'commons']),
  ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(
      commonEachResult,
      mergeGetServerSidePropsResults(serverConfigResult, i18nPropsResult),
    ),
  );
};

export default ForgotPasswordPage;
