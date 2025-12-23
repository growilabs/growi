import type React from 'react';
import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  NextPage,
} from 'next';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';

import { NoLoginLayout } from '~/components/Layout/NoLoginLayout';
import type { CommonEachProps, CommonInitialProps } from '~/pages/common-props';
import {
  getServerSideCommonEachProps,
  getServerSideCommonInitialProps,
  getServerSideI18nProps,
} from '~/pages/common-props';
import { mergeGetServerSidePropsResults } from '~/pages/utils/server-side-props';

type Props = CommonInitialProps & CommonEachProps;
const classNames: string[] = ['login-page'];

const LoginErrorPage: NextPage<Props> = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { message } = router.query;

  let loginErrorElm: React.ReactElement;

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ignore
  const ApprovalPendingUserError = () => {
    return (
      <>
        <div className="alert alert-warning">
          <h2>{t('login.sign_in_error')}</h2>
        </div>
        <p>Wait for approved by administrators.</p>
      </>
    );
  };

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ignore
  const SuspendedUserError = () => {
    return (
      <>
        <div className="alert alert-warning">
          <h2>{t('login.sign_in_error')}</h2>
        </div>
        <p>This account is suspended.</p>
      </>
    );
  };

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ignore
  const PasswordResetOrderError = () => {
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

  // biome-ignore lint/correctness/noNestedComponentDefinitions: ignore
  const DefaultLoginError = () => {
    return (
      <div className="alert alert-warning">
        <h2>{t('login.sign_in_error')}</h2>
      </div>
    );
  };

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

export const getServerSideProps: GetServerSideProps = async (
  context: GetServerSidePropsContext,
) => {
  const [commonInitialResult, commonEachResult, i18nPropsResult] =
    await Promise.all([
      getServerSideCommonInitialProps(context),
      getServerSideCommonEachProps(context),
      getServerSideI18nProps(context, ['translation']),
    ]);

  return mergeGetServerSidePropsResults(
    commonInitialResult,
    mergeGetServerSidePropsResults(commonEachResult, i18nPropsResult),
  );
};

export default LoginErrorPage;
