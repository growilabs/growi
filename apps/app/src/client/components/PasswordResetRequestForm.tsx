import type { FC } from 'react';
import React, { useState, useCallback } from 'react';

import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { isMailerSetupAtom } from '~/states/server-configurations';

const PasswordResetRequestForm: FC = () => {
  const { t } = useTranslation();
  const isMailerSetup = useAtomValue(isMailerSetupAtom);
  const [email, setEmail] = useState('');

  const changeEmail = useCallback((inputValue) => {
    setEmail(inputValue);
  }, []);

  const sendPasswordResetRequestMail = useCallback(async(e) => {
    e.preventDefault();
    if (email === '') {
      toastError(t('forgot_password.email_is_required'));
      return;
    }

    try {
      await apiv3Post('/forgot-password', { email });
      toastSuccess(t('forgot_password.success_to_send_email'));
    }
    catch (err) {
      toastError(err);
    }
  }, [t, email]);

  return (
    <form onSubmit={sendPasswordResetRequestMail}>
      {!isMailerSetup ? (
        <div className="alert alert-danger">
          {t('forgot_password.please_enable_mailer_alert')}
        </div>
      ) : (
        <>
          {/* lock-icon large */}
          <h1><span className="material-symbols-outlined">lock</span></h1>
          <h1 className="text-center">{ t('forgot_password.forgot_password') }</h1>
          <h3>{t('forgot_password.password_reset_request_desc')}</h3>
          <div>
            <div className="input-group">
              <input
                name="email"
                placeholder="E-mail Address"
                className="form-control"
                type="email"
                disabled={!isMailerSetup}
                onChange={e => changeEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button
              className="btn btn-lg btn-primary"
              type="submit"
              disabled={!isMailerSetup}
            >
              {t('forgot_password.send')}
            </button>
          </div>
        </>
      )}
      <Link href="/login" prefetch={false}>
        <span className="material-symbols-outlined">login</span>{t('forgot_password.return_to_login')}
      </Link>
    </form>
  );
};

export default PasswordResetRequestForm;
