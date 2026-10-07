import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';

import type { CommonEachProps, CommonInitialProps } from '../common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '../common-props';
import { mergeGetServerSidePropsResults } from '../utils/server-side-props';

type Props = CommonInitialProps &
  CommonEachProps & {
    errorCode?: forgotPasswordErrorCode;
  };

const ForgotPasswordErrorsPage: NextPage<Props> = (props: Props) => {
  const { t } = useTranslation();
  const { errorCode } = props;

  return (
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

                {errorCode == null && (
                  <h3 className="text-muted">errorCode Unknown</h3>
                )}

                {errorCode ===
                  forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE && (
                  <h3 className="text-muted">
                    {t('forgot_password.feature_is_unavailable')}
                  </h3>
                )}

                {(errorCode ===
                  forgotPasswordErrorCode.PASSWORD_RESET_ORDER_IS_NOT_APPROPRIATE ||
                  errorCode === forgotPasswordErrorCode.TOKEN_NOT_FOUND) && (
                  <div>
                    <div className="alert alert-warning mb-3">
                      <h2>
                        {t('forgot_password.incorrect_token_or_expired_url')}
                      </h2>
                    </div>
                    <Link
                      href="/forgot-password"
                      className="link-switch"
                      prefetch={false}
                    >
                      <span className="material-symbols-outlined">key</span>{' '}
                      {t('forgot_password.forgot_password')}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const getServerSideConfigurationProps: GetServerSideProps<{
  errorCode?: forgotPasswordErrorCode;
}> = async (context: GetServerSidePropsContext) => {
  const errorCode = context.query.errorCode;
  return {
    props: {
      errorCode:
        typeof errorCode === 'string'
          ? (errorCode as forgotPasswordErrorCode)
          : undefined,
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

export default ForgotPasswordErrorsPage;
