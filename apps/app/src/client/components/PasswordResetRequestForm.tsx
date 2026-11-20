import type { FC } from 'react';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import { isMailerSetupAtom } from '~/states/server-configurations';
import { toArrayIfNot } from '~/utils/array-utils';

import styles from './PasswordResetRequestForm.module.scss';

const moduleClass = styles['password-reset-request-form'] ?? '';

const hasErrorCode = (e: unknown, code: string): boolean =>
  typeof e === 'object' && e != null && 'code' in e && e.code === code;

const isPasswordResetRequestFailure = (err: unknown): boolean =>
  toArrayIfNot(err).some((e) =>
    hasErrorCode(e, forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED),
  );

const PasswordResetRequestForm: FC = () => {
  const { t } = useTranslation();
  const isMailerSetup = useAtomValue(isMailerSetupAtom);
  const [email, setEmail] = useState('');

  const changeEmail = useCallback((inputValue) => {
    setEmail(inputValue);
  }, []);

  const sendPasswordResetRequestMail = useCallback(
    async (e) => {
      e.preventDefault();
      if (email === '') {
        toastError(t('forgot_password.email_is_required'));
        return;
      }

      // Acknowledge immediately and keep the form usable. The server answers
      // every request 18 seconds later, and only a failure needs a toast.
      toastSuccess(t('forgot_password.email_sent_if_account_exists'));
      try {
        await apiv3Post('/forgot-password', { email });
      } catch (err) {
        if (isPasswordResetRequestFailure(err)) {
          toastError(t('forgot_password.request_failed'));
          return;
        }
        toastError(err);
      }
    },
    [t, email],
  );

  return (
    <form
      className={`${moduleClass} text-start`}
      onSubmit={sendPasswordResetRequestMail}
    >
      {!isMailerSetup ? (
        <div className="alert alert-danger">
          {t('forgot_password.please_enable_mailer_alert')}
        </div>
      ) : (
        <>
          <div className="text-center mb-4">
            <span
              className="material-symbols-outlined lock-icon"
              aria-hidden="true"
            >
              lock
            </span>
          </div>
          <h1 className="form-title text-center mb-3">
            {t('forgot_password.forgot_password')}
          </h1>
          <p className="form-desc text-center text-body-secondary mb-4">
            {t('forgot_password.password_reset_request_desc')}
          </p>
          <input
            name="email"
            placeholder="name@example.com"
            aria-label={t('forgot_password.email_address')}
            className="form-control mb-3"
            type="email"
            onChange={(e) => changeEmail(e.target.value)}
          />
          <button className="btn btn-primary w-100 fw-bold" type="submit">
            {t('forgot_password.send')}
          </button>
          <p className="form-notice-sm text-center text-body-secondary mt-3 mb-1">
            {t('forgot_password.error_notice_after_send')}
          </p>
          <p className="form-notice text-center text-body-secondary mb-0">
            {t('forgot_password.check_spam_folder_notice')}
          </p>
        </>
      )}
      <hr className="my-4" />
      <div className="text-center">
        <Link
          href="/login"
          prefetch={false}
          className="d-inline-flex align-items-center gap-2 link-body-emphasis text-decoration-none"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            login
          </span>
          {t('forgot_password.return_to_login')}
        </Link>
      </div>
    </form>
  );
};

export default PasswordResetRequestForm;
