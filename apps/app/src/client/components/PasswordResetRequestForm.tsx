import type { FC } from 'react';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { PASSWORD_RESET_RESPONSE_DELAY_MS } from '~/interfaces/password-reset';
import { isMailerSetupAtom } from '~/states/server-configurations';

import { resolvePasswordResetFailureMessageKey } from './password-reset-request-error';

import styles from './PasswordResetRequestForm.module.scss';

const moduleClass = styles['password-reset-request-form'] ?? '';

// Immediate rejections take a few ms on the server, so this mostly budgets
// network round-trip; one arriving later still shows, just after the neutral toast.
export const IMMEDIATE_REJECTION_WAIT_MS = 500;

type RequestResult = { ok: true } | { ok: false; error: Error[] };

/** Resolves with the promise's value, or with null if it is still pending after `ms`. */
const settleWithin = async <T,>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

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

      const request: Promise<RequestResult> = apiv3Post('/forgot-password', {
        email,
      }).then(
        () => ({ ok: true }),
        // apiv3Request rejects with the response's error list.
        (error: Error[]) => ({ ok: false, error }),
      );

      // The server answers every processed request after a fixed delay
      // (PASSWORD_RESET_RESPONSE_DELAY_MS), so a failure this early never
      // depends on whether the account exists (an unavailable feature, a rate
      // limit, invalid input, an unreachable server). Wait briefly for such a
      // failure so it replaces the neutral acknowledgement instead of
      // following it.
      const early = await settleWithin(request, IMMEDIATE_REJECTION_WAIT_MS);
      if (early == null || early.ok) {
        // Acknowledge and keep the form usable; only a failure needs a toast.
        toastSuccess(t('forgot_password.email_sent_if_account_exists'));
      }

      const result = early ?? (await request);
      if (!result.ok) {
        toastError(t(resolvePasswordResetFailureMessageKey(result.error)));
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
            {t('forgot_password.error_notice_after_send', {
              seconds: Math.ceil(PASSWORD_RESET_RESPONSE_DELAY_MS / 1000),
            })}
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
