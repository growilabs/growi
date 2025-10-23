import React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CommonProps } from '~/pages/utils/commons';
import {
  getNextI18NextConfig,
  getServerSideCommonProps,
} from '~/pages/utils/commons';

type Props = CommonProps;
const classNames: string[] = ['login-page'];

const ApprovalPendingUserError = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="alert alert-warning">
        <h2>{t('login.sign_in_error')}</h2>
      </div>
      <p>Wait for approved by administrators.</p>
    </>
  );
};

const SuspendedUserError = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="alert alert-warning">
        <h2>{t('login.sign_in_error')}</h2>
      </div>
      <p>This account is suspended.</p>
    </>
  );
};

const PasswordResetOrderError = () => {
  const { t } = useTranslation();
  return (
    <>
      <div className="alert alert-warning mb-3">
        <h2>{t('forgot_password.incorrect_token_or_expired_url')}</h2>
      </div>
      <a href="/forgot-password" className="link-switch">
        <span className="material-symbols-outlined">key</span>{' '}
        {t('forgot_password.forgot_password')}
      </a>
    </>
  );
};

const DefaultLoginError = () => {
  const { t } = useTranslation();
  return (
    <div className="alert alert-warning">
      <h2>{t('login.sign_in_error')}</h2>
    </div>
  );
};

const LoginPage: NextPage<CommonProps> = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { message } = router.query;

  let loginErrorElm: JSX.Element;

  switch (message) {
    case 'registered':
      loginErrorElm = <ApprovalPendingUserError />;
      break;
    case 'suspended':
      loginErrorElm = <SuspendedUserError />;
      break;
    case 'password-reset-order':
      loginErrorElm = <PasswordResetOrderError />;
      break;
    default:
      loginErrorElm = <DefaultLoginError />;
  }

  return (
    <NoLoginLayout className={classNames.join(' ')}>
      <div className="mb-4 login-form-errors text-center">
        <div className="nologin-dialog pb-4 mx-auto">
          <div className="col-12">{loginErrorElm}</div>
          {/* If the transition source is "/login", use <a /> tag since the transition will not occur if next/link is used. */}
          <a href="/login">
            <span className="material-symbols-outlined me-1">login</span>
            {t('Sign in is here')}
          </a>
        </div>
      </div>
    </NoLoginLayout>
  );
};

/**
 * for Server Side Translations
 * @param context
 * @param props
 * @param namespacesRequired
 */
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

  await injectNextI18NextConfigurations(context, props, ['translation']);

  return {
    props,
  };
};

export default LoginPage;
