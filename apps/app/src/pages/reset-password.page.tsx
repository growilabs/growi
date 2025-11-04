import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { RawLayout } from '~/components/Layout/RawLayout';

import type { CommonProps } from './utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from './utils/commons';

type Props = CommonProps & {
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

// eslint-disable-next-line max-len
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

  const email = context.query.email;
  if (typeof email === 'string') {
    props.email = email;
  }

  await injectNextI18NextConfigurations(context, props, [
    'translation',
    'commons',
  ]);

  return {
    props,
  };
};

export default ForgotPasswordPage;
