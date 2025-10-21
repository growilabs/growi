import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';

import type { CommonProps } from './utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

type Props = CommonProps & {
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

async function injectNextI18NextConfigurations(
  context: GetServerSidePropsContext,
  props: Props,
  namespacesRequired?: string[] | undefined,
): Promise<void> {
  const nextI18NextConfig = await getNextI18NextConfig(
    serverSideTranslations,
    context,
    namespacesRequired,
  );
  props._nextI18Next = nextI18NextConfig._nextI18Next;
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

  const errorCode = context.query.errorCode;
  if (typeof errorCode === 'string') {
    props.errorCode = errorCode as forgotPasswordErrorCode;
  }

  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default ForgotPasswordErrorsPage;
